import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore } from '../store';
import { parseTxError } from '../txUtils';
import Modal from './Modal';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const BORROWER_OPS_SIGS = '0xD757e3646AF370b15f32EB557F0F8380Df7D639e';
const BORROWER_OPS_SIGS_ABI = [{ type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] }];
const TROVE_SIG_DEADLINE = () => Math.floor(Date.now() / 1000) + 86400 * 30;

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
  const { signer, account, chainId, callContract, putContract, musdContract, btcPrice, musdBalance, simpleMode, refresh } = useStore();

  const [position,   setPosition]   = useState('long');
  const [optionType, setOptionType] = useState('call');
  const [strike,     setStrike]     = useState('');
  const [cost,       setCost]       = useState('');
  const [qty,        setQty]        = useState('');
  const [settlType,  setSettlType]  = useState('0');
  const [expiry,     setExpiry]     = useState('86400');
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(false);

  const effectiveSettlType = simpleMode ? '1' : settlType;
  const isShort = position === 'short';
  const isCall  = optionType === 'call';

  const sp = parseFloat(strike), q = parseFloat(qty), c = parseFloat(cost), p = btcPrice;

  const payoff = useMemo(() => {
    if (!sp || !q || !p) return null;
    const notional  = sp * q;
    const pct       = c ? ((c / notional) * 100).toFixed(2) : null;
    const itm       = isCall ? p > sp : p < sp;
    const intrinsic = isCall ? Math.max(0, p - sp) * q : Math.max(0, sp - p) * q;
    const mv        = p * q;
    const collateral = isShort
      ? (effectiveSettlType === '0' ? `${q.toFixed(4)} BTC` : effectiveSettlType === '1' ? `${(mv * 0.67).toFixed(2)} MUSD` : 'Trove signature')
      : `${c.toFixed(2)} MUSD`;
    return { notional, pct, itm, intrinsic, collateral };
  }, [strike, qty, cost, btcPrice, isCall, isShort, effectiveSettlType]); // eslint-disable-line

  // Validation
  const warnings = useMemo(() => {
    const w = [];
    if (sp && p) {
      if (isCall && sp < p * 0.9) w.push('Strike is deep ITM — high premium expected');
      if (!isCall && sp > p * 1.1) w.push('Strike is deep ITM — high premium expected');
      if (isCall && sp > p * 1.5) w.push('Strike is far OTM — option may expire worthless');
      if (!isCall && sp < p * 0.5) w.push('Strike is far OTM — option may expire worthless');
    }
    if (c && sp && q) {
      const musd = parseFloat(musdBalance?.replace(/,/g, '') || '0');
      if (!isShort && musd < c) w.push(`Insufficient MUSD balance (have ${musdBalance})`);
    }
    return w;
  }, [sp, q, c, p, isCall, isShort, musdBalance]);

  const submit = async () => {
    setModal(false);
    setLoading(true);
    try {
      const spWei = ethers.parseUnits((sp * q).toString(), 18);
      const cWei  = ethers.parseUnits(cost, 18);
      const qWei  = ethers.parseUnits(qty, 18);
      const mv    = p * q;
      const expiryTs = Math.floor(Date.now() / 1000) + parseInt(expiry);
      let tx;

      if (isCall && !isShort) {
        await (await musdContract.approve(await callContract.getAddress(), cWei)).wait();
        tx = await (await callContract.createNewOptionLong(spWei, cWei, qWei, expiryTs)).wait();
      } else if (isCall && isShort) {
        if (effectiveSettlType === '2') {
          const bos = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bos.getNonce(account); const deadline = TROVE_SIG_DEADLINE();
          const profit = ethers.parseUnits((mv * 0.67).toFixed(6), 18);
          const sig = await signTroveAdjust(signer, await callContract.getAddress(), account, profit, nonce, deadline, chainId);
          tx = await (await callContract.createNewOptionShort(2, spWei, cWei, qWei, 0, expiryTs, sig, deadline)).wait();
        } else if (effectiveSettlType === '1') {
          const margin = ethers.parseUnits((mv * 0.67).toFixed(6), 18);
          await (await musdContract.approve(await callContract.getAddress(), margin)).wait();
          tx = await (await callContract.createNewOptionShort(1, spWei, cWei, qWei, margin, expiryTs, '0x', 0)).wait();
        } else {
          tx = await (await callContract.createNewOptionShort(0, spWei, cWei, qWei, 0, expiryTs, '0x', 0, { value: qWei })).wait();
        }
      } else if (!isCall && !isShort) {
        await (await musdContract.approve(await putContract.getAddress(), cWei)).wait();
        tx = await (await putContract.createNewOptionLong(effectiveSettlType, spWei, cWei, qWei, expiryTs)).wait();
      } else {
        if (effectiveSettlType === '2') {
          const bos = new ethers.Contract(BORROWER_OPS_SIGS, BORROWER_OPS_SIGS_ABI, signer);
          const nonce = await bos.getNonce(account); const deadline = TROVE_SIG_DEADLINE();
          const sig = await signTroveAdjust(signer, await putContract.getAddress(), account, spWei, nonce, deadline, chainId);
          tx = await (await putContract.createNewOptionShort(spWei, cWei, qWei, 0, expiryTs, sig, deadline)).wait();
        } else {
          await (await musdContract.approve(await putContract.getAddress(), spWei)).wait();
          tx = await (await putContract.createNewOptionShort(spWei, cWei, qWei, spWei, expiryTs, '0x', 0)).wait();
        }
      }
      refresh();
      toast.success(<TxToast msg="Order placed." hash={tx?.hash} />);
      setStrike(''); setCost(''); setQty('');
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

  const canSubmit = strike && cost && qty && !loading && callContract;

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
            <Field label="Premium" placeholder="MUSD" hint={payoff?.pct ? `${payoff.pct}%` : null} value={cost} onChange={setCost} />
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

          {payoff && (
            <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs font-mono">
              <Row label="Notional"   value={`$${payoff.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
              <Row label="Intrinsic"  value={payoff.intrinsic > 0 ? `$${payoff.intrinsic.toFixed(2)}` : '—'} accent={payoff.intrinsic > 0} />
              <Row label="Moneyness"  value={payoff.itm ? 'ITM' : 'OTM'} accent={payoff.itm} />
              <Row label="Collateral" value={payoff.collateral} />
            </div>
          )}

          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-500/80 bg-yellow-500/5 border border-yellow-500/20 rounded px-2 py-1.5">⚠ {w}</p>
          ))}

          {isShort && !simpleMode && (
            <div className="space-y-2">
              <button type="button" data-tour="trove-margin" onClick={() => setSettlType('2')}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${settlType === '2' ? 'border-accent/50 bg-accent/5' : 'border-border bg-surface hover:border-accent/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-display font-semibold text-accent">✦ Trove Margin</span>
                  {settlType === '2' && <span className="text-xs text-accent">Selected</span>}
                </div>
                <p className="text-xs text-dim mt-0.5">Use your Mezo Trove as margin — no capital lockup.</p>
              </button>
              <div>
                <label className="block text-xs text-dim font-body mb-1">Or choose margin type</label>
                <select value={settlType} onChange={e => setSettlType(e.target.value)} className="input-field">
                  <option value="0">BTC (lock collateral)</option>
                  <option value="1">MUSD (2/3 margin)</option>
                  <option value="2">Trove (Mezo) — no lockup</option>
                </select>
              </div>
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
            <Row label="Type"       value={`${isShort ? 'Short' : 'Long'} ${isCall ? 'Call' : 'Put'}`} />
            <Row label="Strike"     value={`$${parseFloat(strike).toLocaleString()}`} />
            <Row label="Quantity"   value={`${qty} BTC`} />
            <Row label="Premium"    value={`${cost} MUSD`} />
            {payoff && <Row label="Collateral" value={payoff.collateral} />}
            {payoff && <Row label="Notional"   value={`$${payoff.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />}
          </div>
          {warnings.length > 0 && warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-500/80 bg-yellow-500/5 border border-yellow-500/20 rounded px-2 py-1.5">⚠ {w}</p>
          ))}
          <p className="text-xs text-dim">This will require a wallet approval + transaction.</p>
          <div className="flex gap-3">
            <button onClick={() => setModal(false)} className="btn-ghost flex-1">Cancel</button>
            <button onClick={submit} className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-opacity ${isShort ? 'bg-red/20 text-red border border-red/30' : 'btn-primary'}`}>
              Confirm & Sign
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
