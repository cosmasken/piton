import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore } from '../store';

const BORROWER_OPS_SIGS = '0xD757e3646AF370b15f32EB557F0F8380Df7D639e';
const BORROWER_OPS_SIGS_ABI = [{ type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] }];
const TROVE_SIG_DEADLINE = () => Math.floor(Date.now() / 1000) + 86400 * 30;

async function signTroveAdjust(signer, contractAddress, borrower, debtChange, nonce, deadline, chainId) {
  const domain = { name: 'BorrowerOperationsSignatures', version: '1', chainId, verifyingContract: contractAddress };
  const types  = { AdjustTrove: [
    { name: 'collWithdrawal', type: 'uint256' }, { name: 'debtChange', type: 'uint256' },
    { name: 'isDebtIncrease', type: 'bool' },    { name: 'assetAmount', type: 'uint256' },
    { name: 'borrower', type: 'address' },        { name: 'recipient', type: 'address' },
    { name: 'nonce', type: 'uint256' },           { name: 'deadline', type: 'uint256' },
  ]};
  return signer.signTypedData(domain, types, {
    collWithdrawal: 0n, debtChange, isDebtIncrease: true, assetAmount: 0n, // eslint-disable-line no-undef
    borrower, recipient: contractAddress, nonce, deadline: BigInt(deadline), // eslint-disable-line no-undef
  });
}

export default function NewOrder() {
  const { signer, account, chainId, callContract, putContract, musdContract, btcPrice, refresh } = useStore();

  const [position,   setPosition]   = useState('long');
  const [optionType, setOptionType] = useState('call');
  const [strike,     setStrike]     = useState('');
  const [cost,       setCost]       = useState('');
  const [qty,        setQty]        = useState('');
  const [settlType,  setSettlType]  = useState('0');
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(false);

  const isShort = position === 'short';
  const isCall  = optionType === 'call';
  const showSettlType = isShort;

  // payoff reference
  const payoff = useMemo(() => {
    const sp = parseFloat(strike), q = parseFloat(qty), c = parseFloat(cost), p = btcPrice;
    if (!sp || !q || !p) return null;
    const notional = sp * q;
    const pct = c ? ((c / notional) * 100).toFixed(2) : null;
    const itm = isCall ? p > sp : p < sp;
    const intrinsic = isCall ? Math.max(0, p - sp) * q : Math.max(0, sp - p) * q;
    return { notional, pct, itm, intrinsic };
  }, [strike, qty, cost, btcPrice, isCall]);

  const validate = async (e) => {
    e.preventDefault();
    if (!strike || !cost || !qty || +strike <= 0 || +cost <= 0 || +qty <= 0) return;
    setModal(true);
  };

  const submit = async () => {
    setModal(false);
    setLoading(true);
    try {
      const sp = ethers.parseUnits((+strike * +qty).toString(), 18);
      const c  = ethers.parseUnits(cost, 18);
      const q  = ethers.parseUnits(qty, 18);
      const mv = btcPrice * parseFloat(qty);

      if (isCall && !isShort) {
        await (await musdContract.approve(await callContract.getAddress(), c)).wait();
        await (await callContract.createNewOptionLong(sp, c, q)).wait();
      } else if (isCall && isShort) {
        if (settlType === '2') {
          const bos = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bos.getNonce(account); const deadline = TROVE_SIG_DEADLINE();
          const profit = ethers.parseUnits((mv * 0.67).toFixed(6), 18);
          const sig = await signTroveAdjust(signer, await callContract.getAddress(), account, profit, nonce, deadline, chainId);
          await (await callContract.createNewOptionShort(2, sp, c, q, 0, sig, deadline)).wait();
        } else if (settlType === '1') {
          const margin = ethers.parseUnits((mv * 0.67).toFixed(6), 18);
          await (await musdContract.approve(await callContract.getAddress(), margin)).wait();
          await (await callContract.createNewOptionShort(1, sp, c, q, margin, '0x', 0)).wait();
        } else {
          await (await callContract.createNewOptionShort(0, sp, c, q, 0, '0x', 0, { value: q })).wait();
        }
      } else if (!isCall && !isShort) {
        await (await musdContract.approve(await putContract.getAddress(), c)).wait();
        await (await putContract.createNewOptionLong(settlType, sp, c, q)).wait();
      } else {
        if (settlType === '2') {
          const bos = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bos.getNonce(account); const deadline = TROVE_SIG_DEADLINE();
          const sig = await signTroveAdjust(signer, await putContract.getAddress(), account, sp, nonce, deadline, chainId);
          await (await putContract.createNewOptionShort(sp, c, q, 0, sig, deadline)).wait();
        } else {
          await (await musdContract.approve(await putContract.getAddress(), sp)).wait();
          await (await putContract.createNewOptionShort(sp, c, q, sp, '0x', 0)).wait();
        }
      }
      refresh();
      toast.success('Order placed.');
      setStrike(''); setCost(''); setQty('');
    } catch (err) {
      toast.error(err?.reason || err?.message || 'Transaction failed.');
    } finally { setLoading(false); }
  };

  const Field = ({ label, placeholder, value, onChange, hint }) => (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-xs text-dim font-body">{label}</label>
        {hint && <span className="text-xs text-dim font-mono">{hint}</span>}
      </div>
      <input className="input-field" type="number" step="any" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );

  return (
    <div className="panel flex flex-col overflow-hidden flex-1">
      <div className="panel-header">New Order</div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* Long/Short */}
        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          <button onClick={() => setPosition('long')}  className={`flex-1 py-2 transition-colors ${!isShort ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Long</button>
          <button onClick={() => setPosition('short')} className={`flex-1 py-2 transition-colors ${isShort  ? 'bg-red/10 text-red'     : 'text-dim'}`}>Short</button>
        </div>

        {/* Call/Put */}
        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setOptionType(t)}
              className={`flex-1 py-2 uppercase tracking-wider transition-colors ${optionType === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>

        <form onSubmit={validate} className="space-y-3">
          <Field label="Strike Price" placeholder="MUSD / 1 BTC"
            hint={btcPrice ? `Spot: $${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : null}
            value={strike} onChange={setStrike} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Premium" placeholder="MUSD"
              hint={payoff?.pct ? `${payoff.pct}%` : null}
              value={cost} onChange={setCost} />
            <Field label="Quantity" placeholder="BTC" value={qty} onChange={setQty} />
          </div>

          {/* payoff reference */}
          {payoff && (
            <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-dim">Notional</span>
                <span>${payoff.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Intrinsic value</span>
                <span className={payoff.intrinsic > 0 ? 'text-accent' : 'text-dim'}>
                  {payoff.intrinsic > 0 ? `$${payoff.intrinsic.toFixed(2)}` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">Moneyness</span>
                <span className={payoff.itm ? 'text-accent' : 'text-red'}>{payoff.itm ? 'ITM' : 'OTM'}</span>
              </div>
            </div>
          )}

          {showSettlType && (
            <div>
              <label className="block text-xs text-dim font-body mb-1">Margin / Settlement</label>
              <select value={settlType} onChange={e => setSettlType(e.target.value)} className="input-field">
                <option value="0">BTC</option>
                <option value="1">MUSD</option>
                <option value="2">Trove (Mezo)</option>
              </select>
              {settlType === '2' && <p className="text-xs text-dim mt-1">Trove equity used as margin. Requires EIP-712 signature.</p>}
            </div>
          )}

          <button type="submit" disabled={loading || !callContract}
            className={`w-full py-2.5 rounded-md font-display font-bold text-sm transition-opacity disabled:opacity-40 ${
              isShort ? 'bg-red/20 text-red border border-red/30' : 'bg-accent/20 text-accent border border-accent/30'
            }`}>
            {loading ? 'Processing…' : isShort ? 'Place Sell Order' : 'Place Buy Order'}
          </button>
        </form>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="panel w-80 p-6 space-y-4">
            <p className="font-display font-semibold text-text">Confirm Order</p>
            <p className="text-sm text-dim font-body">{isShort ? 'Short' : 'Long'} {isCall ? 'Call' : 'Put'} · Strike {strike} · {qty} BTC · Premium {cost} MUSD</p>
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
