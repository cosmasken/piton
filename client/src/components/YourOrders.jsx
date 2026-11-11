import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, STATUS } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { explorerTx } from '../network.mjs';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import { instrumentName } from '../instruments.mjs';
import { bsPrice, greeks } from '../greeks';
import { breakEven, maxGain, maxLoss, PROTOCOL_FEE_BPS } from '../payoff.mjs';
import { SkeletonRow } from './Skeleton';
import PayoffChart from './PayoffChart';

const fmtE = v => v == null ? 0 : parseFloat(ethers.formatEther(v));
const money = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d });
const signed = v => `${v >= 0 ? '+' : ''}${money(v)}`;

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={explorerTx(useStore.getState().network, hash)} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function StatusBadge({ o, live }) {
  const base = 'text-[10px] px-1.5 py-0.5 rounded';
  if (o.status === STATUS.SETTLED)  return <span className={`${base} text-accent bg-accent/10`}>Exercised</span>;
  if (o.status === STATUS.REFUNDED) return <span className={`${base} text-dim bg-surface`}>Expired / cancelled</span>;
  if (o.status === STATUS.CLOSED)   return <span className={`${base} text-accent bg-accent/10`}>Sold back</span>;
  if (o.status === STATUS.OPEN)     return <span className={`${base} text-dim bg-surface`}>{o.short === ethers.ZeroAddress ? 'Bid resting' : 'Ask resting'}</span>;
  return live ? <span className={`${base} text-accent bg-accent/10`}>Live</span> : <span className={`${base} text-yellow-500 bg-yellow-500/10`}>Expired: refund</span>;
}

function OptionRow({ o, account, spot, iv, poolContract, refresh }) {
  const exp    = useCountdown(o.expiry);
  const isCall = o.optionType === 0n;
  const isLong = o.long?.toLowerCase() === account?.toLowerCase();
  const now    = Math.floor(Date.now() / 1000);
  const live   = Number(o.expiry) > now;
  const strike = fmtE(o.strike), qty = fmtE(o.quantity), premium = fmtE(o.premium);
  const filledLive = o.status === STATUS.FILLED && live;

  // mark-to-market with the same model the pool uses (mid IV); P&L if closed at that value
  const hours = Math.max(0, (Number(o.expiry) - now) / 3600);
  const mark = filledLive && spot ? bsPrice(isCall, spot, strike, hours, iv) * qty : null;
  const pnl = mark == null ? null : isLong ? mark - premium : premium * (1 - PROTOCOL_FEE_BPS / 10000) - mark;
  const intrinsic = spot ? Math.max(0, isCall ? spot - strike : strike - spot) * qty : 0;
  const itm = intrinsic > 0;
  const canSettle = filledLive && isLong && itm;
  const canRefund = o.status === STATUS.FILLED && !live;
  const canCancel = o.status === STATUS.OPEN;

  // Sell back: the pool buys back options it sold, at a bid under the mid value
  const canSellBack = filledLive && isLong && o.filledByPool;
  const [bid, setBid] = useState(null);
  useEffect(() => {
    let off = false;
    const load = () => poolContract.quoteBuyback(o.id).then(v => { if (!off) setBid(fmtE(v)); }).catch(() => {});
    if (canSellBack && poolContract) { load(); const id = setInterval(load, 15_000); return () => { off = true; clearInterval(id); }; }
    return () => { off = true; };
  }, [canSellBack, o.id, poolContract]);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(null);
  const canAuto = filledLive && isLong;
  useEffect(() => {
    let off = false;
    if (canAuto && poolContract) poolContract.autoExercise(o.id).then(v => { if (!off) setAuto(v); }).catch(() => {});
    return () => { off = true; };
  }, [canAuto, o.id, poolContract]);

  const act = async (fn, msg) => {
    setLoading(true);
    try { const tx = await fn(); refresh(); toast.success(<TxToast msg={msg} hash={tx?.hash} />); }
    catch (e) { toast.error(parseTxError(e)); }
    finally { setLoading(false); }
  };
  const toggleAuto = () => act(async () => {
    const tx = await (await poolContract.setAutoExercise(o.id, !auto)).wait();
    setAuto(!auto);
    return tx;
  }, !auto ? 'Auto-exercise on: a keeper exercises this in its last 5 minutes if it is in the money (0.5% tip).' : 'Auto-exercise off.');

  const leg = { side: isLong ? 'buy' : 'sell', isCall, strike, qty, premium, collateral: fmtE(o.collateral) || 0, feeBps: PROTOCOL_FEE_BPS };
  const g = spot ? greeks(isCall, spot, strike, hours, iv) : {};
  const name = instrumentName({ isCall, strike, expiry: o.expiry });

  return (
    <>
      <tr className="border-b border-border hover:bg-surface/50 transition-colors cursor-pointer" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <td className="px-3 py-2.5 font-mono text-[11px]"><span className={isCall ? 'text-accent' : 'text-red'}>{name.replace('BTC-', '')}</span></td>
        <td className="px-3 py-2.5 text-xs text-dim">{isLong ? 'Long' : 'Short'}</td>
        <td className="px-3 py-2.5 font-mono text-xs">{money(qty, 4)}</td>
        <td className="px-3 py-2.5 font-mono text-xs text-dim">{money(premium / qty, 1)}</td>
        <td className="px-3 py-2.5 font-mono text-xs">{mark != null ? money(mark / qty, 1) : '—'}</td>
        <td className="px-3 py-2.5 font-mono text-xs">
          {pnl != null ? <span className={pnl >= 0 ? 'text-accent' : 'text-red'}>{signed(pnl)}</span> : <StatusBadge o={o} live={live} />}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs">{o.status === STATUS.SETTLED || o.status === STATUS.REFUNDED || o.status === STATUS.CLOSED ? '—' : exp}</td>
        <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          {loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin inline-block" />}
          {!loading && canAuto && auto !== null && (
            <button onClick={toggleAuto} title="Let a keeper exercise this for you in the last 5 minutes if it is in the money (0.5% of the payout)"
              className={`mr-2 text-[10px] px-1.5 py-0.5 rounded border ${auto ? 'text-accent border-accent/40 bg-accent/10' : 'text-dim border-border'}`}>Auto {auto ? 'on' : 'off'}</button>
          )}
          {!loading && canSellBack && bid > 0 && (
            <button onClick={() => act(() => poolContract.sellBack(o.id, ethers.parseEther((bid * 0.98).toFixed(8))).then(tx => tx.wait()), `Sold back to the pool for about ${money(bid)} MUSD.`)}
              title="Sell this option back to the pool now, at its bid price" className="mr-2 text-xs font-display font-semibold text-accent hover:opacity-70">Sell back {money(bid)}</button>
          )}
          {!loading && canSettle && <button onClick={() => act(() => poolContract.settle(o.id).then(tx => tx.wait()), 'Exercised!')} className="text-accent text-xs font-display font-semibold hover:opacity-70">Exercise</button>}
          {!loading && canRefund && <button onClick={() => act(() => poolContract.refund(o.id).then(tx => tx.wait()), 'Refunded!')} className="text-dim text-xs hover:text-text">Refund</button>}
          {!loading && canCancel && <button onClick={() => act(() => poolContract.cancelOrder(o.id).then(tx => tx.wait()), 'Cancelled!')} className="text-dim text-xs hover:text-text">Cancel</button>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface/30">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-dim">{isLong ? 'Premium paid' : 'Premium received (net of 2% fee)'}</span><span className="font-mono">{money(isLong ? premium : premium * 0.98)} MUSD</span></div>
                {!isLong && <div className="flex justify-between"><span className="text-dim">Collateral locked</span><span className="font-mono">{money(fmtE(o.collateral))} MUSD</span></div>}
                {leg.collateral > 0 && <>
                  <div className="flex justify-between"><span className="text-dim">Max loss / max gain</span><span className="font-mono">{money(maxLoss(leg))} / {money(maxGain(leg))}</span></div>
                  <div className="flex justify-between"><span className="text-dim">Break-even at expiry</span><span className="font-mono">{breakEven(leg) ? `$${money(breakEven(leg), 0)}` : 'none'}</span></div>
                </>}
                {canSellBack && <div className="flex justify-between"><span className="text-dim">Pool bid (sell back now)</span><span className="font-mono">{bid != null ? `${money(bid)} MUSD` : '—'}</span></div>}
                <div className="flex justify-between"><span className="text-dim">Exercise value now</span><span className={`font-mono ${itm ? 'text-accent' : ''}`}>{money(intrinsic)} MUSD {itm ? '(in the money)' : ''}</span></div>
                {g.delta != null && filledLive && <div className="flex justify-between"><span className="text-dim">Delta · theta/day</span><span className="font-mono">{g.delta} · {g.theta}</span></div>}
                <div className="flex justify-between"><span className="text-dim">Order #{String(o.id)}</span><span className="font-mono text-dim">{o.filledByPool ? 'sold by the pool' : 'peer to peer'}</span></div>
              </div>
              {leg.collateral > 0 ? <PayoffChart leg={leg} spot={spot} height={120} /> : <p className="text-xs text-dim self-center">Payoff chart appears once the order is matched.</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function YourOrders() {
  const { account, poolContract, btcPrice, options, poolParams, ordersLoading, refresh } = useStore(useShallow(s => ({ account: s.account, poolContract: s.poolContract, btcPrice: s.btcPrice, options: s.options, poolParams: s.poolParams, ordersLoading: s.ordersLoading, refresh: s.refresh })));
  const [tab, setTab] = useState('active');
  const now = Math.floor(Date.now() / 1000);

  const mine = useMemo(() => options.filter(o =>
    o.long?.toLowerCase() === account?.toLowerCase() || o.short?.toLowerCase() === account?.toLowerCase()), [options, account]);
  const active = mine.filter(o => o.status === STATUS.OPEN || (o.status === STATUS.FILLED && Number(o.expiry) > now) || (o.status === STATUS.FILLED && Number(o.expiry) <= now));
  const history = mine.filter(o => o.status === STATUS.SETTLED || o.status === STATUS.REFUNDED || o.status === STATUS.CLOSED);
  const list = (tab === 'active' ? active : history).slice().sort((a, b) => Number(b.id - a.id));
  const iv = poolParams?.iv || 0.8;

  // headline numbers for the live book
  const totals = useMemo(() => {
    let pnl = 0, atRisk = 0, locked = 0;
    for (const o of mine) {
      if (o.status !== STATUS.FILLED || Number(o.expiry) <= now || !btcPrice) continue;
      const isCall = o.optionType === 0n, strike = fmtE(o.strike), qty = fmtE(o.quantity), premium = fmtE(o.premium);
      const mark = bsPrice(isCall, btcPrice, strike, (Number(o.expiry) - now) / 3600, iv) * qty;
      if (o.long?.toLowerCase() === account?.toLowerCase()) { pnl += mark - premium; atRisk += premium; }
      else { pnl += premium * (1 - PROTOCOL_FEE_BPS / 10000) - mark; locked += fmtE(o.collateral); }
    }
    return { pnl, atRisk, locked };
  }, [mine, btcPrice, iv]); // eslint-disable-line

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center gap-2">
        <span>Positions</span>
        <div className="flex gap-1 ml-auto">
          {['active', 'history'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2 py-0.5 rounded capitalize font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>
      </div>
      {account && tab === 'active' && (totals.atRisk > 0 || totals.locked > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-border text-[11px]">
          <span className="text-dim">Open P&L <span className={`font-mono ${totals.pnl >= 0 ? 'text-accent' : 'text-red'}`}>{signed(totals.pnl)} MUSD</span></span>
          <span className="text-dim">Premium at risk <span className="font-mono text-text">{money(totals.atRisk)}</span></span>
          <span className="text-dim">Collateral locked <span className="font-mono text-text">{money(totals.locked)}</span></span>
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0">
        {ordersLoading ? (
          <div>{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : !account ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">Connect your wallet to see positions</div>
        ) : list.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">No {tab} positions</div>
        ) : (
          <table className="w-full text-xs min-w-[640px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                {['Option', 'Side', 'Size', 'Entry', 'Mark', 'P&L / status', 'Expires', ''].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-dim">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(o => <OptionRow key={String(o.id)} o={o} account={account} spot={btcPrice} iv={iv} poolContract={poolContract} refresh={refresh} />)}
            </tbody>
          </table>
        )}
      </div>
      {account && list.length > 0 && <p className="px-4 py-1.5 text-[10px] text-dim/60 border-t border-border">Entry and mark are MUSD per 1 BTC. Mark uses the pool's mid volatility; Sell back pays the pool's bid, a little under mark. Click a row for the payoff at expiry.</p>}
    </div>
  );
}
