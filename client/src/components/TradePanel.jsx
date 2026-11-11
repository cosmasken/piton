import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useStore, ADDRESSES } from '../store';
import { explorerTx } from '../network.mjs';
import { parseTxError } from '../txUtils';
import { useNow } from '../useNow';
import { poolWontFill, fmtDuration } from '../poolRules.mjs';
import { instrumentName, bookFor, expirySlots } from '../instruments.mjs';
import { collateralFor, breakEven, maxGain, maxLoss, PROTOCOL_FEE_BPS } from '../payoff.mjs';
import { greeks } from '../greeks';
import Modal from './Modal';
import ProtectTrove from './ProtectTrove';
import PayoffChart from './PayoffChart';

const BORROWER_OPS_SIGS_ABI = [{ type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] }];

// Mezo WithdrawMUSD typed data: commits to the exact amount and recipient and is consumed in the same
// transaction (never stored), so it expires after 10 minutes.
async function signTroveWithdraw(signer, sigsAddress, borrower, amount, recipient, nonce, deadline, chainId) {
  const domain = { name: 'BorrowerOperationsSignatures', version: '1', chainId, verifyingContract: sigsAddress };
  const types  = { WithdrawMUSD: [
    { name: 'amount', type: 'uint256' }, { name: 'borrower', type: 'address' },
    { name: 'recipient', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ]};
  return signer.signTypedData(domain, types, { amount, borrower, recipient, nonce, deadline: BigInt(deadline) });
}

function TxToast({ msg, hash }) {
  return <div><div>{msg}</div>{hash && <a href={explorerTx(useStore.getState().network, hash)} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a>}</div>;
}

function Row({ label, value, tone }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-xs text-dim">{label}</span>
      <span className={`font-mono text-xs text-right ${tone || 'text-text'}`}>{value}</span>
    </div>
  );
}

const fmt = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d });
const E18 = v => ethers.parseEther(Number(v).toFixed(8));

/** Positions the user holds in the selected option that the pool will buy back, with the live bid. */
function CloseBox({ inst, options, account, poolContract, refresh }) {
  const mine = useMemo(() => options.filter(o =>
    o.status === 1n && o.filledByPool && o.long?.toLowerCase() === account?.toLowerCase() &&
    (o.optionType === 0n) === inst.isCall && Math.round(Number(o.strike) / 1e18) === Math.round(inst.strike) && Number(o.expiry) === inst.expiry), [options, account, inst]);
  const [bids, setBids] = useState({});
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let off = false;
    const load = async () => {
      const out = {};
      for (const o of mine) { try { out[String(o.id)] = parseFloat(ethers.formatEther(await poolContract.quoteBuyback(o.id))); } catch { /* ignore */ } }
      if (!off) setBids(out);
    };
    if (mine.length && poolContract) { load(); const id = setInterval(load, 15_000); return () => { off = true; clearInterval(id); }; }
    return () => { off = true; };
  }, [mine, poolContract]);
  if (!mine.length) return null;
  const sell = async o => {
    setBusy(o.id);
    try {
      const tx = await (await poolContract.sellBack(o.id, E18((bids[String(o.id)] || 0) * 0.98))).wait();
      refresh(); toast.success(<TxToast msg="Sold back to the pool." hash={tx?.hash} />);
    } catch (e) { toast.error(parseTxError(e)); } finally { setBusy(null); }
  };
  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 space-y-1.5">
      <p className="text-xs font-display font-semibold text-accent">Close your position</p>
      {mine.map(o => {
        const q = parseFloat(ethers.formatEther(o.quantity)), bid = bids[String(o.id)];
        return (
          <div key={String(o.id)} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-dim">You hold <span className="font-mono text-text">{q.toFixed(4)} BTC</span>{bid != null && <> · pool bid <span className="font-mono text-text">{bid.toFixed(2)} MUSD</span></>}</span>
            <button type="button" disabled={busy != null || !(bid > 0)} onClick={() => sell(o)} className="px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40">
              {busy === o.id ? '…' : 'Sell back'}
            </button>
          </div>
        );
      })}
      <p className="text-[10px] text-dim">The pool buys back at its mid price less a volatility spread, so you get a little less than the mark. Exercising or holding to expiry is always an option.</p>
    </div>
  );
}

export default function TradePanel() {
  const {
    signer, account, chainId, poolContract, musdContract, btcPrice: spot, options, poolParams,
    selected, setSelected, refresh, oracleStale, roPool, musdBalance, musdRaw,
  } = useStore();
  const now = useNow(5000);
  const { isConnected } = useAccount();
  const { connect } = useConnect();

  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('market');
  const [qty, setQty] = useState('0.01');
  const [price, setPrice] = useState('');           // MUSD per 1 BTC
  const [marginType, setMarginType] = useState('musd');
  const [autoEx, setAutoEx] = useState(true);
  const [quote, setQuote] = useState(null);         // pool price for exactly this order (total MUSD)
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const inst = selected;
  const q = parseFloat(qty);
  const secs = inst ? inst.expiry - now : 0;
  const expired = inst && secs <= 0;
  const slots = useMemo(() => expirySlots(now), [Math.floor(now / 600)]); // eslint-disable-line

  // follow the chain's choice of instrument and side
  useEffect(() => { if (inst?.side) setSide(inst.side); if (inst?.side === 'sell') setOrderType('limit'); }, [inst?.isCall, inst?.strike, inst?.expiry, inst?.side]); // eslint-disable-line
  useEffect(() => { if (side === 'sell') setOrderType('limit'); }, [side]);

  // ask the contract what the pool would charge for exactly this order
  useEffect(() => {
    setQuote(null);
    if (!inst || !(q > 0) || expired) return;
    let off = false;
    const run = async () => {
      try {
        const pool = roPool(); if (!pool) return;
        const v = await pool.quotePremium(inst.isCall, E18(inst.strike), E18(q), inst.expiry);
        if (!off) setQuote(parseFloat(ethers.formatEther(v)));
      } catch { if (!off) setQuote(null); }
    };
    run();
    const id = setInterval(run, 15_000);
    return () => { off = true; clearInterval(id); };
  }, [inst?.isCall, inst?.strike, inst?.expiry, q]); // eslint-disable-line

  // default the limit price to the pool's price per BTC
  useEffect(() => { if (quote != null && q > 0 && (price === '' || orderType === 'market')) setPrice((quote / q).toFixed(2)); }, [quote]); // eslint-disable-line

  const book = useMemo(() => inst ? bookFor(options, inst) : { asks: [], bids: [], bestAsk: null, bestBid: null }, [options, inst]);
  const reasons = inst && spot ? poolWontFill({ spot, strike: inst.strike, expirySecs: secs, nowSec: now }, poolParams || {}) : [];
  const collateral = inst && q > 0 ? collateralFor(inst.isCall, spot, inst.strike, q) : 0;
  const px = orderType === 'market' && side === 'buy' ? (quote != null && q > 0 ? quote / q : NaN) : parseFloat(price);
  const premium = px * q;                                    // total MUSD
  const poolWillFill = side === 'buy' && reasons.length === 0 && quote != null && premium >= quote * 0.95;
  const leg = inst && premium > 0 && q > 0 ? { side, isCall: inst.isCall, strike: inst.strike, qty: q, premium, collateral, feeBps: PROTOCOL_FEE_BPS } : null;
  const dlt = inst && spot ? greeks(inst.isCall, spot, inst.strike, Math.max(0, secs) / 3600, poolParams?.iv || 0.8).delta : null;

  const needWallet = !poolContract;
  const overCap = poolParams && collateral > poolParams.maxOptionCollateral;
  const blockedMsg = !inst ? 'Pick an option in the chain.'
    : expired ? 'This expiry has passed.'
    : oracleStale ? 'Oracle price is stale; trading resumes when it updates.'
    : !(q > 0) ? 'Enter a size.'
    : !(px > 0) ? (side === 'buy' && orderType === 'market' ? 'The pool has no price for this order.' : 'Enter a price.')
    : overCap ? `Size too large: collateral ${fmt(collateral)} MUSD exceeds the per-option limit of ${fmt(poolParams.maxOptionCollateral, 0)} MUSD.`
    : needWallet ? 'Connect your wallet to trade.'
    : musdBalance !== '—' && !(side === 'sell' && marginType === 'trove')
      && (buy ? premium : collateral) > parseFloat(musdRaw)
      ? `Not enough MUSD: this needs ${fmt(buy ? premium : collateral)} and the wallet has ${musdBalance}.` : null;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const tx = await fn(); refresh(); toast.success(<TxToast msg={okMsg()} hash={tx?.hash} />); }
    catch (e) { toast.error(parseTxError(e)); }
    finally { setBusy(false); setConfirm(null); }
  };

  const submit = () => {
    const poolAddr = ADDRESSES[chainId].pool;
    const typeId = inst.isCall ? 0 : 1;
    const strikeWei = E18(inst.strike), qtyWei = E18(q), premiumWei = E18(premium);
    let msg = 'Order placed.';
    return run(async () => {
      if (side === 'buy') {
        await (await musdContract.approve(poolAddr, premiumWei)).wait();
        const tx = await (await poolContract.createLongOrder(typeId, strikeWei, qtyWei, inst.expiry, premiumWei)).wait();
        const placed = await poolContract.getOption((await poolContract.nextId()) - 1n);
        if (placed.filledByPool && autoEx) {
          await (await poolContract.setAutoExercise(placed.id, true)).wait();
          msg = 'Bought from the pool. Auto-exercise is on: if it is in the money near expiry, a keeper exercises it for 0.5% of the payout.';
        } else if (placed.filledByPool) msg = 'Bought from the pool. Exercise it yourself before expiry if it is in the money.';
        else msg = 'Not filled by the pool: your order is a resting bid and your premium is held. Cancel it any time in Positions.';
        return tx;
      }
      if (marginType === 'trove') {
        const required = inst.isCall ? (spot * 3 - inst.strike) * q * 1.05 : inst.strike * q; // 5% buffer on calls; unused margin returns at expiry
        const marginWei = E18(required);
        const sigs = ADDRESSES[chainId].borrowerOpsSigs;
        const nonce = await new ethers.Contract(sigs, BORROWER_OPS_SIGS_ABI, signer).getNonce(account);
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const sig = await signTroveWithdraw(signer, sigs, account, marginWei, account, nonce, deadline, chainId);
        await (await musdContract.approve(poolAddr, marginWei)).wait();
        msg = 'Sell order posted with Trove margin. It rests on the book until a buyer takes it.';
        return (await poolContract.createShortOrderTrove(typeId, strikeWei, qtyWei, inst.expiry, premiumWei, marginWei, sig, deadline)).wait();
      }
      await (await musdContract.approve(poolAddr, E18(collateral))).wait();
      msg = 'Sell order posted. It rests on the book until a buyer takes it; cancel it any time in Positions.';
      return (await poolContract.createShortOrder(typeId, strikeWei, qtyWei, inst.expiry, premiumWei)).wait();
    }, () => msg);
  };

  // take a specific resting order from the book
  const hitAsk = o => run(async () => {
    await (await musdContract.approve(ADDRESSES[chainId].pool, o.premiumWei)).wait();
    return (await poolContract.fillLong(o.id)).wait();
  }, () => 'Bought.');
  const hitBid = o => run(async () => {
    const need = collateralFor(inst.isCall, spot, inst.strike, o.qty) * (inst.isCall ? 1.02 : 1); // contract recomputes call collateral at fill time
    await (await musdContract.approve(ADDRESSES[chainId].pool, E18(need))).wait();
    return (await poolContract.fillShort(o.id)).wait();
  }, () => 'Sold into the bid.');

  const applyProtection = ({ strike, qty: qy }) => {
    const exp = slots.find(t => t - now >= 20 * 3600) || slots[0];
    setSelected({ isCall: false, strike: Number(strike), expiry: exp, side: 'buy' });
    setQty(qy); setOrderType('market'); setSide('buy');
  };

  const buy = side === 'buy';
  const cta = busy ? 'Waiting…' : needWallet ? 'Connect wallet' : buy ? (orderType === 'market' ? 'Buy from pool' : 'Place bid') : 'Post sell order';

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center justify-between gap-2">
        <span>Trade</span>
        {inst && <span className="font-mono normal-case tracking-normal text-text text-xs">{instrumentName(inst)}</span>}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold" role="tablist" aria-label="Side">
          <button role="tab" aria-selected={buy} onClick={() => setSide('buy')} className={`flex-1 py-2 transition-colors ${buy ? 'bg-accent/15 text-accent' : 'text-dim'}`}>Buy</button>
          <button role="tab" aria-selected={!buy} onClick={() => setSide('sell')} className={`flex-1 py-2 transition-colors ${!buy ? 'bg-red/15 text-red' : 'text-dim'}`}>Sell</button>
        </div>

        {!inst ? (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-dim">
            Pick a call or put in the option chain to start. Click an <span className="text-text">ask</span> to buy it or a <span className="text-text">bid</span> to sell into it.
          </div>
        ) : (
          <>
            <div className="bg-surface rounded-md px-3 py-2 space-y-1">
              <Row label="Option" value={`${inst.isCall ? 'Call' : 'Put'} · strike $${inst.strike.toLocaleString()}`} />
              <Row label="Expires in" value={expired ? 'expired' : fmtDuration(secs)} />
              <Row label="Spot / delta" value={`$${fmt(spot, 0)} · Δ ${dlt ?? '—'}`} />
            </div>

            {!buy && <CloseBox inst={inst} options={options} account={account} poolContract={poolContract} refresh={refresh} />}

            {buy && (
              <div className="flex rounded-md overflow-hidden border border-border text-[11px] font-display font-semibold" role="tablist" aria-label="Order type">
                {['market', 'limit'].map(t => (
                  <button key={t} role="tab" aria-selected={orderType === t} onClick={() => { setOrderType(t); if (t === 'market' && quote != null && q > 0) setPrice((quote / q).toFixed(2)); }}
                    className={`flex-1 py-1.5 capitalize transition-colors ${orderType === t ? 'bg-surface text-text' : 'text-dim'}`}>
                    {t === 'market' ? 'Market (pool price)' : 'Limit'}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-dim block mb-1" htmlFor="qty">Size (BTC)</label>
                <input id="qty" className="input-field" type="number" step="any" min="0" value={qty} onChange={e => setQty(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-dim block mb-1" htmlFor="px">Price (MUSD / BTC)</label>
                <input id="px" className="input-field disabled:opacity-60" type="number" step="any" min="0" disabled={buy && orderType === 'market'}
                  value={buy && orderType === 'market' ? (Number.isFinite(px) ? px.toFixed(2) : '') : price} onChange={e => setPrice(e.target.value)} />
              </div>
            </div>

            {buy && quote != null && <p className="text-[10px] text-dim">Pool price for this size: <span className="font-mono text-text">{fmt(quote)} MUSD</span> (<span className="font-mono">{fmt(quote / q)}</span> per BTC). Bigger orders cost more as the pool fills.</p>}
            {side === 'sell' && book.bestBid && (
              <button type="button" onClick={() => setPrice(book.bestBid.price.toFixed(2))} className="text-[10px] text-accent hover:opacity-70">
                Best bid: {fmt(book.bestBid.price)} per BTC (use this price)
              </button>
            )}

            {buy && reasons.length > 0 && (
              <div className="rounded-md border border-yellow-700/40 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-400 space-y-1">
                <p className="font-semibold">The pool won't sell this itself:</p>
                <ul className="list-disc pl-4">{reasons.map(r => <li key={r}>{r}</li>)}</ul>
                <p className="text-yellow-400/80">A buy order here rests as a bid until a seller takes it; you can cancel it for a refund.</p>
              </div>
            )}
            {buy && reasons.length === 0 && px > 0 && orderType === 'limit' && (
              <p className={`text-[10px] ${poolWillFill ? 'text-accent' : 'text-yellow-400'}`}>
                {poolWillFill ? 'At this price the pool should fill your order straight away.' : 'Below the pool price: this rests on the book as a bid until a seller accepts.'}
              </p>
            )}

            {leg && (
              <div className="bg-surface rounded-md px-3 py-2 space-y-1">
                <Row label={buy ? 'You pay' : 'You receive (after 2% fee)'} value={`${fmt(buy ? premium : premium * 0.98)} MUSD`} tone={buy ? 'text-text' : 'text-accent'} />
                {!buy && <Row label="You lock as collateral" value={`${fmt(collateral)} MUSD`} />}
                <Row label="Max loss" value={`${fmt(maxLoss(leg))} MUSD`} tone="text-red" />
                <Row label="Max gain" value={`${fmt(maxGain(leg))} MUSD`} tone="text-accent" />
                <Row label="Break-even at expiry" value={breakEven(leg) ? `$${fmt(breakEven(leg), 0)}` : 'none'} />
              </div>
            )}

            {buy && (
              <label className="flex items-start gap-2 text-xs text-dim cursor-pointer">
                <input type="checkbox" checked={autoEx} onChange={e => setAutoEx(e.target.checked)} className="mt-0.5" />
                <span>Exercise automatically near expiry if it is in the money (a keeper does it in the last 5 minutes and keeps 0.5% of the payout). Otherwise you must exercise before expiry.</span>
              </label>
            )}

            {!buy && (
              <div className="space-y-1.5">
                <button type="button" onClick={() => setMarginType(m => m === 'trove' ? 'musd' : 'trove')}
                  className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${marginType === 'trove' ? 'border-accent/50 bg-accent/5' : 'border-border bg-surface hover:border-accent/30'}`}>
                  <span className="text-xs font-display font-semibold text-accent">✦ Trove margin {marginType === 'trove' ? '(selected)' : ''}</span>
                  <p className="text-xs text-dim mt-0.5">Borrow the margin from your Mezo Trove; your BTC stays in it. Unused margin returns as MUSD at expiry.</p>
                </button>
              </div>
            )}

            {buy && <ProtectTrove onApply={applyProtection} />}
          </>
        )}

        {blockedMsg && inst && !(needWallet && !isConnected) && <p className="text-xs text-dim" role="status">{blockedMsg}</p>}
        <button type="button" disabled={busy || (!!blockedMsg && !(needWallet && !isConnected))} onClick={() => (needWallet && !isConnected) ? connect({ connector: injected() }) : setConfirm(true)}
          className={`w-full py-2.5 rounded-md font-display font-bold text-sm transition-opacity disabled:opacity-40 flex items-center justify-center gap-2 ${buy ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-red/20 text-red border border-red/30'}`}>
          {busy && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}{cta}
        </button>

        {leg && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-dim">Profit and loss at expiry</p>
            <PayoffChart leg={leg} spot={spot} />
          </div>
        )}

        {inst && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-dim">Order book · {instrumentName(inst)}</p>
            <div className="text-xs font-mono border border-border rounded-md overflow-hidden">
              {[...book.asks].reverse().map(o => (
                <button key={`a${o.id}`} type="button" disabled={needWallet || busy || o.owner === account} onClick={() => setConfirm({ ask: o })}
                  className="w-full flex justify-between px-3 py-1 hover:bg-white/5 text-red disabled:opacity-60" title={o.owner === account ? 'Your order' : 'Click to buy this order'}>
                  <span>{fmt(o.price)}</span><span className="text-dim">{fmt(o.qty, 4)} BTC</span><span className="text-dim">{o.owner === account ? 'yours' : 'buy →'}</span>
                </button>
              ))}
              <div className={`flex justify-between px-3 py-1 bg-surface ${poolWillFill || reasons.length === 0 ? 'text-accent' : 'text-dim'}`}>
                <span>{quote != null && q > 0 && reasons.length === 0 ? fmt(quote / q) : '—'}</span><span>Pool ask</span><span>{reasons.length === 0 ? 'market' : 'not selling'}</span>
              </div>
              {[...book.bids].map(o => (
                <button key={`b${o.id}`} type="button" disabled={needWallet || busy || o.owner === account} onClick={() => setConfirm({ bid: o })}
                  className="w-full flex justify-between px-3 py-1 hover:bg-white/5 text-accent disabled:opacity-60" title={o.owner === account ? 'Your order' : 'Click to sell into this order'}>
                  <span>{fmt(o.price)}</span><span className="text-dim">{fmt(o.qty, 4)} BTC</span><span className="text-dim">{o.owner === account ? 'yours' : '← sell'}</span>
                </button>
              ))}
              {!book.asks.length && !book.bids.length && <p className="px-3 py-2 text-dim">No resting orders for this option yet. Yours would be first.</p>}
            </div>
          </div>
        )}

        <p className="text-[10px] text-dim/60 leading-relaxed">Unaudited testnet contracts. Options can expire worthless; a buyer can lose the whole premium. Cash-settled in MUSD.</p>
      </div>

      {confirm && (
        <Modal title={confirm.ask ? 'Buy resting order' : confirm.bid ? 'Sell into bid' : `Confirm ${buy ? 'buy' : 'sell'}`} onClose={() => setConfirm(null)}>
          <div className="space-y-1 bg-surface rounded-md px-3 py-3">
            <Row label="Option" value={instrumentName(inst)} />
            {confirm.ask ? <>
              <Row label="Size" value={`${fmt(confirm.ask.qty, 4)} BTC`} />
              <Row label="You pay" value={`${fmt(confirm.ask.total)} MUSD`} />
            </> : confirm.bid ? <>
              <Row label="Size" value={`${fmt(confirm.bid.qty, 4)} BTC`} />
              <Row label="You receive" value={`${fmt(confirm.bid.total * 0.98)} MUSD (after 2% fee)`} tone="text-accent" />
              <Row label="You lock" value={`${fmt(collateralFor(inst.isCall, spot, inst.strike, confirm.bid.qty))} MUSD`} />
            </> : <>
              <Row label="Size" value={`${fmt(q, 4)} BTC`} />
              <Row label="Price" value={`${fmt(px)} MUSD per BTC`} />
              <Row label={buy ? 'You pay' : 'You receive (after fee)'} value={`${fmt(buy ? premium : premium * 0.98)} MUSD`} />
              {!buy && <Row label="You lock" value={`${fmt(collateral)} MUSD`} />}
              <Row label="Outcome" value={buy ? (poolWillFill ? 'Filled by pool' : 'May rest as a bid') : 'Rests on the book'} />
            </>}
          </div>
          <p className="text-xs text-dim">Your wallet will ask for an approval and then the trade.</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirm(null)} className="btn-ghost flex-1">Cancel</button>
            <button disabled={busy} onClick={() => confirm.ask ? hitAsk(confirm.ask) : confirm.bid ? hitBid(confirm.bid) : submit()}
              className={`flex-1 py-2 rounded-md font-display font-semibold text-sm disabled:opacity-50 ${!buy && !confirm.ask ? 'bg-red/20 text-red border border-red/30' : 'btn-primary'}`}>
              {busy ? 'Confirming…' : 'Confirm & sign'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
