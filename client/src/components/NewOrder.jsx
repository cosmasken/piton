import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Modal, Button, Spinner } from 'react-bootstrap';
import { toast } from 'react-toastify';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

// Mezo matsnet BorrowerOperationsSignatures address
const BORROWER_OPS_SIGS = '0xD757e3646AF370b15f32EB557F0F8380Df7D639e';
const BORROWER_OPS_SIGS_ABI = [
  { type: 'function', name: 'getNonce', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] }
];

// 30-day deadline for Trove signatures
const TROVE_SIG_DEADLINE = () => Math.floor(Date.now() / 1000) + 86400 * 30;

/**
 * Signs an adjustTroveWithSignature EIP-712 payload.
 * Matches the domain/typehash used by Mezo's BorrowerOperationsSignatures.
 */
async function signTroveAdjust(signer, contractAddress, borrower, debtChange, nonce, deadline, chainId) {
  const domain = {
    name: 'BorrowerOperationsSignatures',
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  };
  const types = {
    AdjustTrove: [
      { name: 'collWithdrawal',  type: 'uint256' },
      { name: 'debtChange',      type: 'uint256' },
      { name: 'isDebtIncrease',  type: 'bool'    },
      { name: 'assetAmount',     type: 'uint256' },
      { name: 'borrower',        type: 'address' },
      { name: 'recipient',       type: 'address' },
      { name: 'nonce',           type: 'uint256' },
      { name: 'deadline',        type: 'uint256' },
    ],
  };
  // recipient is the option contract — passed as contractAddress param here
  // but we don't know it at sign time; use zero address and let the contract fill it.
  // Actually the contract IS the recipient — we need its address.
  // We pass it in as `contractAddress` (the option contract address).
  const value = {
    collWithdrawal: 0n, // eslint-disable-line no-undef
    debtChange,
    isDebtIncrease: true,
    assetAmount: 0n, // eslint-disable-line no-undef
    borrower,
    recipient: contractAddress,
    nonce,
    deadline: BigInt(deadline), // eslint-disable-line no-undef
  };
  return signer.signTypedData(domain, types, value);
}

export default function NewOrder({ provider, signer, account, callContract, putContract, onRefresh }) {
  const [position, setPosition]     = useState('long');
  const [optionType, setOptionType] = useState('call');
  const [strike, setStrike]         = useState('');
  const [cost, setCost]             = useState('');
  const [qty, setQty]               = useState('');
  const [settlType, setSettlType]   = useState('0');
  const [loading, setLoading]       = useState(false);
  const [modal, setModal]           = useState(false);
  const [marketVal, setMarketVal]   = useState(0);

  const isShort = position === 'short';
  const isCall  = optionType === 'call';
  const showSettlType = (isCall && isShort) || (!isCall && !isShort);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const validate = async (e) => {
    e.preventDefault();
    if (!strike || !cost || !qty || +strike <= 0 || +cost <= 0 || +qty <= 0) return;
    const mv = await callContract.getMarketValue();
    setMarketVal(parseFloat(ethers.formatUnits(mv, 18)) * parseFloat(qty));
    setModal(true);
  };

  const submit = async () => {
    setModal(false);
    setLoading(true);
    try {
      const musd = await getMusd();
      const sp   = ethers.parseUnits((+strike * +qty).toString(), 18);
      const c    = ethers.parseUnits(cost, 18);
      const q    = ethers.parseUnits(qty, 18);

      if (isCall && !isShort) {
        await (await musd.approve(await callContract.getAddress(), c)).wait();
        await (await callContract.createNewOptionLong(sp, c, q)).wait();
      } else if (isCall && isShort) {
        if (settlType === '2') {
          const { chainId } = await provider.getNetwork();
          const bosContract = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bosContract.getNonce(account);
          const deadline = TROVE_SIG_DEADLINE();
          const profit = ethers.parseUnits((marketVal * 0.67).toFixed(6), 18);
          const sig = await signTroveAdjust(signer, await callContract.getAddress(), account, profit, nonce, deadline, Number(chainId));
          await (await callContract.createNewOptionShort(2, sp, c, q, 0, sig, deadline)).wait();
        } else if (settlType === '1') {
          const margin = ethers.parseUnits((marketVal * 0.67).toFixed(6), 18);
          await (await musd.approve(await callContract.getAddress(), margin)).wait();
          await (await callContract.createNewOptionShort(1, sp, c, q, margin, '0x', 0)).wait();
        } else {
          await (await callContract.createNewOptionShort(0, sp, c, q, 0, '0x', 0, { value: q })).wait();
        }
      } else if (!isCall && !isShort) {
        await (await musd.approve(await putContract.getAddress(), c)).wait();
        await (await putContract.createNewOptionLong(settlType, sp, c, q)).wait();
      } else {
        if (settlType === '2') {
          const { chainId } = await provider.getNetwork();
          const bosContract = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bosContract.getNonce(account);
          const deadline = TROVE_SIG_DEADLINE();
          const sig = await signTroveAdjust(signer, await putContract.getAddress(), account, sp, nonce, deadline, Number(chainId));
          await (await putContract.createNewOptionShort(sp, c, q, 0, sig, deadline)).wait();
        } else {
          await (await musd.approve(await putContract.getAddress(), sp)).wait();
          await (await putContract.createNewOptionShort(sp, c, q, sp, '0x', 0)).wait();
        }
      }
      onRefresh();
      toast.success('Order placed.');
    } catch (err) {
      console.error(err);
      toast.error(err?.reason || err?.message || 'Transaction failed.');
    } finally {
      setLoading(false);
    }
  };

  const Field = ({ label, placeholder, value, onChange }) => (
    <div>
      <label className="block text-xs text-dim font-body mb-1">{label}</label>
      <input
        className="input-field"
        type="number" step="any"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-header">New Order</div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Long / Short toggle */}
        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          <button
            onClick={() => setPosition('long')}
            className={`flex-1 py-2 transition-colors ${isShort ? 'text-dim' : 'bg-accent/10 text-accent'}`}
          >Long</button>
          <button
            onClick={() => setPosition('short')}
            className={`flex-1 py-2 transition-colors ${!isShort ? 'text-dim' : 'bg-red/10 text-red'}`}
          >Short</button>
        </div>

        {/* Call / Put toggle */}
        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          {['call', 'put'].map(t => (
            <button key={t}
              onClick={() => setOptionType(t)}
              className={`flex-1 py-2 transition-colors uppercase tracking-wider ${optionType === t ? 'bg-surface text-text' : 'text-dim'}`}
            >{t}</button>
          ))}
        </div>

        <form onSubmit={validate} className="space-y-3">
          <Field label="Strike Price" placeholder="MUSD / 1 BTC" value={strike} onChange={setStrike} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Premium" placeholder="MUSD" value={cost} onChange={setCost} />
            <Field label="Quantity" placeholder="BTC" value={qty} onChange={setQty} />
          </div>

          {showSettlType && (
            <div>
              <label className="block text-xs text-dim font-body mb-1">Margin / Settlement</label>
              <select
                value={settlType}
                onChange={e => setSettlType(e.target.value)}
                className="input-field"
              >
                <option value="0">BTC</option>
                <option value="1">MUSD</option>
                <option value="2">Trove (Mezo)</option>
              </select>
              {settlType === '2' && (
                <p className="text-xs text-dim mt-1">Trove equity used as margin. Requires EIP-712 signature.</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2.5 rounded-md font-display font-bold text-sm transition-opacity disabled:opacity-50 ${
              isShort ? 'bg-red/20 text-red border border-red/30' : 'bg-accent/20 text-accent border border-accent/30'
            }`}
          >
            {loading ? 'Processing…' : isShort ? 'Place Sell Order' : 'Place Buy Order'}
          </button>
        </form>
      </div>

      {/* Confirm modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="panel w-80 p-6 space-y-4">
            <p className="font-display font-semibold text-text">Confirm Order</p>
            <p className="text-sm text-dim font-body">
              {isShort ? 'Short' : 'Long'} {isCall ? 'Call' : 'Put'} · Strike {strike} · {qty} BTC · Premium {cost} MUSD
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModal(false)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={submit} className="btn-primary flex-1">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
