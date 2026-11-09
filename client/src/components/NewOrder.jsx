import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, ADDRESSES } from '../store';
import { parseTxError } from '../txUtils';
import Modal from './Modal';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const BORROWER_OPS_SIGS = '0xD757e3646AF370b15f32EB557F0F8380Df7D639e';
const BORROWER_OPS_SIGS_ABI = [{ type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] }];

async function signTroveAdjust(signer, contractAddress, borrower, debtChange, nonce, deadline, chainId) {
  const domain = { name: 'BorrowerOperationsSignatures', version: '1', chainId, verifyingContract: contractAddress };
  const types  = { AdjustTrove: [
    { name: 'collWithdrawal', type: 'uint256' }, { name: 'debtChange',     type: 'uint256' },
    { name: 'isDebtIncrease', type: 'bool'    }, { name: 'assetAmount',    type: 'uint256' },
    { name: 'borrower',       type: 'address' }, { name: 'recipient',      type: 'address' },
    { name: 'nonce',          type: 'uint256' }, { name: 'deadline',       type: 'uint256' },
  ]};
  return signer.signTypedData(domain, types, {
    collWithdrawal: 0n, debtChange, isDebtIncrease: true, assetAmount: 0n,
    borrower, recipient: contractAddress, nonce, deadline: BigInt(deadline),
  });
}

function TxToast({ msg, hash }) {
  return (
    <div>
      <div>{msg}</div>
      {hash && <a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a>}
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ? 'text-accent' : 'text-text'}`}>{value}</span>
    </div>
  );
}

export default function NewOrder() {
  const { signer, account, chainId, poolContract, musdContract, btcPrice, musdBalance, refresh } = useStore();

  const [position,   setPosition]   = useState('long');
  const [optionType, setOptionType] = useState('call');
  const [strike,     setStrike]     = useState('');
  const [premium,    setPremium]    = useState('');
  const [qty,        setQty]        = useState('');
  const [marginType, setMarginType] = useState('musd'); // 'musd' | 'trove'
  const [expiry,     setExpiry]     = useState('86400');
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(false);
  const [bsQuote,    setBsQuote]    = useState(null);

  const isShort = position === 'short';
  const isCall  = optionType === 'call';
  const sp = parseFloat(strike), q = parseFloat(qty), c = parseFloat(premium), p = btcPrice;

  const payoff = useMemo(() => {
    if (!sp || !q || !p) return null;
    const itm       = isCall ? p > sp : p < sp;
    const intrinsic = isCall ? Math.max(0, p - sp) * q : Math.max(0, sp - p) * q;
    const collateral = isShort
      ? (isCall ? `${((p * 2 - sp) * q).toFixed(2)} MUSD` : `${(sp * q).toFixed(2)} MUSD`)
      : `${c.toFixed(2)} MUSD`;
    return { itm, intrinsic, collateral };
  }, [strike, qty, premium, btcPrice, isCall, isShort]); // eslint-disable-line

  const fetchBsQuote = async () => {
    if (!poolContract || !sp || !q) return;
    try {
      const block = await poolContract.runner.provider.getBlock('latest');
      const exp   = block.timestamp + parseInt(expiry);
      const quote = await poolContract.quotePremium(isCall, ethers.parseEther(sp.toString()), ethers.parseEther(q.toString()), exp);
      setBsQuote(parseFloat(ethers.formatEther(quote)).toFixed(4));
    } catch {}
  };

  const submit = async () => {
    setModal(false);
    setLoading(true);
    try {
      const strikeWei  = ethers.parseEther(sp.toString());
      const premiumWei = ethers.parseEther(c.toString());
      const qtyWei     = ethers.parseEther(q.toString());
      const block      = await poolContract.runner.provider.getBlock('latest');
      const expiryTs   = block.timestamp + parseInt(expiry);
      const poolAddr   = ADDRESSES[chainId].pool;
      let tx;

      if (!isShort) {
        // Long order — pool fills automatically
        await (await musdContract.approve(poolAddr, premiumWei)).wait();
        tx = await (await poolContract.createLongOrder(
          isCall ? 0 : 1, strikeWei, qtyWei, expiryTs, premiumWei
        )).wait();
      } else if (marginType === 'trove') {
        // Short with Trove margin
        const bos      = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
        const nonce    = await bos.getNonce(account);
        const deadline = Math.floor(Date.now() / 1000) + 86400 * 30;
        const collWei  = isCall
          ? ethers.parseEther(((p * 2 - sp) * q).toFixed(6))
          : ethers.parseEther((sp * q).toFixed(6));
        const sig = await signTroveAdjust(signer, poolAddr, account, collWei, nonce, deadline, chainId);
        tx = await (await poolContract.createShortOrderTrove(
          isCall ? 0 : 1, strikeWei, qtyWei, expiryTs, premiumWei, sig, deadline
        )).wait();
      } else {
        // Short with MUSD collateral
        const collWei = isCall
          ? ethers.parseEther(((p * 2 - sp) * q).toFixed(6))
          : ethers.parseEther((sp * q).toFixed(6));
        await (await musdContract.approve(poolAddr, collWei)).wait();
        tx = await (await poolContract.createShortOrder(
          isCall ? 0 : 1, strikeWei, qtyWei, expiryTs, premiumWei
        )).wait();
      }

      refresh();
      toast.success(<TxToast msg="Order placed." hash={tx?.hash} />);
      setStrike(''); setPremium(''); setQty(''); setBsQuote(null);
    } catch (err) {
      toast.error(parseTxError(err));
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

  const canSubmit = strike && premium && qty && !loading && poolContract;

  return (
    <div className="panel flex flex-col overflow-hidden flex-1">
      <div className="panel-header">New Order</div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          <button onClick={() => setPosition('long')}  className={`flex-1 py-2 transition-colors ${!isShort ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Long</button>
          <button onClick={() => setPosition('short')} className={`flex-1 py-2 transition-colors ${isShort  ? 'bg-red/10 text-red'     : 'text-dim'}`}>Short</button>
        </div>

        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setOptionType(t)}
              className={`flex-1 py-2 uppercase tracking-wider transition-colors ${optionType === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>

        <form onSubmit={e => { e.preventDefault(); if (!canSubmit) return; setModal(true); }} className="space-y-3">
          <Field label="Strike Price" placeholder="MUSD / 1 BTC"
            hint={btcPrice ? `Spot: $${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : null}
            value={strike} onChange={setStrike} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-xs text-dim font-body">Premium</label>
                {bsQuote && <span className="text-xs text-accent font-mono cursor-pointer" onClick={() => setPremium(bsQuote)}>BS: {bsQuote} ↵</span>}
              </div>
              <div className="flex gap-1">
                <input className="input-field flex-1" type="number" step="any" placeholder="MUSD" value={premium} onChange={e => setPremium(e.target.value)} />
                {!isShort && <button type="button" onClick={fetchBsQuote} className="px-2 text-xs text-dim border border-border rounded hover:text-accent transition-colors">BS</button>}
              </div>
            </div>
            <Field label="Quantity" placeholder="BTC" value={qty} onChange={setQty} />
          </div>

          <div>
            <label className="block text-xs text-dim font-body mb-1">Expiry</label>
            <select value={expiry} onChange={e => setExpiry(e.target.value)} className="input-field">
              <option value="900">15 minutes</option>
              <option value="3600">1 hour</option>
              <option value="21600">6 hours</option>
              <option value="86400">1 day</option>
              <option value="259200">3 days</option>
              <option value="604800">7 days</option>
              <option value="1209600">14 days</option>
            </select>
          </div>

          {isShort && (
            <div className="space-y-2">
              <button type="button" onClick={() => setMarginType('trove')}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${marginType === 'trove' ? 'border-accent/50 bg-accent/5' : 'border-border bg-surface hover:border-accent/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-display font-semibold text-accent">✦ Trove Margin</span>
                  {marginType === 'trove' && <span className="text-xs text-accent">Selected</span>}
                </div>
                <p className="text-xs text-dim mt-0.5">Use your Mezo Trove as margin — no capital lockup.</p>
              </button>
              {marginType === 'trove' && (
                <button type="button" onClick={() => setMarginType('musd')} className="text-xs text-dim hover:text-text transition-colors">
                  Switch to MUSD collateral instead
                </button>
              )}
            </div>
          )}

          {payoff && (
            <div className="bg-surface rounded-md px-3 py-2 space-y-1">
              <Row label="Moneyness"  value={payoff.itm ? 'ITM' : 'OTM'} accent={payoff.itm} />
              <Row label="Intrinsic"  value={payoff.intrinsic > 0 ? `$${payoff.intrinsic.toFixed(2)}` : '—'} accent={payoff.intrinsic > 0} />
              <Row label="Collateral" value={payoff.collateral} />
              {!isShort && <Row label="Settlement" value="Cash (MUSD)" />}
            </div>
          )}

          <button type="submit" disabled={!canSubmit}
            className={`w-full py-2.5 rounded-md font-display font-bold text-sm transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 ${
              isShort ? 'bg-red/20 text-red border border-red/30' : 'bg-accent/20 text-accent border border-accent/30'
            }`}>
            {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Waiting…' : isShort ? 'Place Sell Order' : 'Place Buy Order'}
          </button>
        </form>
      </div>

      {modal && (
        <Modal title="Confirm Order" onClose={() => setModal(false)}>
          <div className="space-y-1 bg-surface rounded-md px-3 py-3">
            <Row label="Type"     value={`${isShort ? 'Short' : 'Long'} ${isCall ? 'Call' : 'Put'}`} />
            <Row label="Strike"   value={`$${parseFloat(strike).toLocaleString()}`} />
            <Row label="Quantity" value={`${qty} BTC`} />
            <Row label="Premium"  value={`${premium} MUSD`} />
            {payoff && <Row label="Collateral" value={payoff.collateral} />}
            {isShort && <Row label="Margin" value={marginType === 'trove' ? 'Trove (Mezo)' : 'MUSD'} />}
            {!isShort && <Row label="Settlement" value="Cash (MUSD)" />}
          </div>
          <p className="text-xs text-dim">This will require a wallet approval + transaction.</p>
          <div className="flex gap-3">
            <button onClick={() => setModal(false)} className="btn-ghost flex-1">Cancel</button>
            <button onClick={submit} className={`flex-1 py-2 rounded-md font-display font-semibold text-sm ${isShort ? 'bg-red/20 text-red border border-red/30' : 'btn-primary'}`}>
              Confirm & Sign
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
