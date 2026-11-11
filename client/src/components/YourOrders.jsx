import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, STATUS } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Flash } from './Live';
import { explorerTx } from '../network.mjs';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import { instrumentName } from '../instruments.mjs';
import { bsPrice, greeks } from '../greeks';
import { breakEven, maxGain, maxLoss, PROTOCOL_FEE_BPS } from '../payoff.mjs';
import { livePositions, realisedPnl, toCsv } from '../portfolio.mjs';
import { SkeletonRow } from './Skeleton';
import PayoffChart from './PayoffChart';
import { useTimes } from '../useTimes';

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
  const times  = useTimes();
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
        <td className="px-3 py-2.5 font-mono text-[11px]"><span className={isCall ? 'text-accent' : 'text-red'} title={`${times.title(Number(o.expiry))} (names use UTC)`}>{name.replace('BTC-', '')}</span></td>
        <td className="px-3 py-2.5 text-xs text-dim">{isLong ? 'Long' : 'Short'}</td>
        <td className="px-3 py-2.5 font-mono text-xs">{money(qty, 4)}</td>
        <td className="px-3 py-2.5 font-mono text-xs text-dim">{money(premium / qty, 1)}</td>
        <td className="px-3 py-2.5 font-mono text-xs">{mark != null ? <Flash value={Math.round(mark / qty * 10)}>{money(mark / qty, 1)}</Flash> : '—'}</td>
        <td className="px-3 py-2.5 font-mono text-xs">
          {pnl != null ? <Flash value={Math.round(pnl * 100)} className={`px-0.5 ${pnl >= 0 ? 'text-accent' : 'text-red'}`}>{signed(pnl)}</Flash> : <StatusBadge o={o} live={live} />}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs">{o.status === STATUS.SETTLED || o.status === STATUS.REFUNDED || o.status === STATUS.CLOSED ? '—' : <span title={times.full(Number(o.expiry))}>{exp}</span>}</td>
        <td className="px-3 py-2.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          {loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin inline-block" />}
          {!loading && canAuto && auto !== null && (
            <button onClick={toggleAuto} title="Let a keeper exercise this for you in the last 5 minutes if it is in the money (0.5% of the payout)"
              className={`mr-2 text-[10px] px-1.5 py-0.5 rounded border ${auto ? 'text-accent border-accent/40 bg-accent/10' : 'text-dim border-border'}`}>Auto {auto ? 'on' : 'off'}</button>
          )}
          {!loading && canSellBack && bid > 0 && (
            <button onClick={() => act(() => poolContract.sellBack(o.id, ethers.parseEther((bid * (1 - (useStore.getState().settings.slippagePct || 2) / 100)).toFixed(8))).then(tx => tx.wait()), `Sold back to the pool for about ${money(bid)} MUSD.`)}
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

const KIND = { ORDER: 'Order placed', FILL: 'Bought / filled', EXERCISE: 'Exercised', REFUND: 'Expired / refunded', SELL_BACK: 'Sold back', CANCEL: 'Cancelled', DEPOSIT: 'Pool deposit', WITHDRAW: 'Pool withdrawal' };
const optName = o => (o ? instrumentName({ isCall: o.optionType === 'CALL', strike: Number(o.strike), expiry: Number(o.expiry) }).replace('BTC-', '') : '');

/** Portfolio greeks and money totals for live positions. */
function Totals({ t }) {
  const g = (label, v, d, title) => <span className="text-dim" title={title}>{label} <span className={`font-mono ${v >= 0 ? 'text-text' : 'text-red'}`}>{v >= 0 ? '+' : ''}{d(v)}</span></span>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-border text-[11px]">
      <span className="text-dim">Open P&L <Flash value={Math.round(t.pnl * 100)} className={`font-mono px-0.5 ${t.pnl >= 0 ? 'text-accent' : 'text-red'}`}>{signed(t.pnl)} MUSD</Flash></span>
      <span className="text-dim">Premium at risk <span className="font-mono text-text">{money(t.premiumAtRisk)}</span></span>
      {t.collateralLocked > 0 && <span className="text-dim">Collateral locked <span className="font-mono text-text">{money(t.collateralLocked)}</span></span>}
      {g('Δ', t.delta, v => v.toFixed(4), 'Portfolio delta: BTC-equivalent exposure (MUSD change per $1 BTC move)')}
      {g('Γ', t.gamma, v => v.toExponential(2), 'Portfolio gamma: change in delta per $1 BTC move')}
      {g('Θ/day', t.theta, v => v.toFixed(2), 'Portfolio theta: MUSD gained (+) or lost (-) per day from time passing')}
      {g('Vega', t.vega, v => v.toFixed(2), 'Portfolio vega: MUSD change for a 1-point rise in volatility')}
    </div>
  );
}

/** Wallet activity from the subgraph: every order, fill, exercise, sell-back, refund, cancel, deposit and withdrawal. */
function HistoryTab({ history, account, network, unrealised }) {
  const realised = useMemo(() => realisedPnl(history.ended, account), [history, account]);
  const times = useTimes();
  const pnlById = useMemo(() => Object.fromEntries(realised.rows.map(r => [r.id, r.pnl])), [realised]);
  const rows = history.activities;
  const exportCsv = () => {
    const csv = toCsv(['time_utc', 'action', 'option', 'amount_musd', 'shares_ymusd', 'realised_pnl_musd', 'tx'],
      rows.map(a => [new Date(Number(a.timestamp) * 1000).toISOString(), KIND[a.kind] || a.kind, optName(a.option), a.amount, a.shares ?? '',
        ['EXERCISE', 'SELL_BACK', 'REFUND'].includes(a.kind) && a.option && pnlById[a.option.id] != null ? pnlById[a.option.id].toFixed(6) : '', a.tx]));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a');
    el.href = url; el.download = `piton-${account.slice(0, 8)}-history.csv`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-b border-border text-[11px]">
        <span className="text-dim">Realised P&L <span className={`font-mono ${realised.total >= 0 ? 'text-accent' : 'text-red'}`}>{signed(realised.total)} MUSD</span></span>
        <span className="text-dim">Unrealised <span className={`font-mono ${unrealised >= 0 ? 'text-accent' : 'text-red'}`}>{signed(unrealised)} MUSD</span></span>
        <span className="text-dim">{realised.rows.length} ended · {rows.length} actions</span>
        <button onClick={exportCsv} disabled={!rows.length} className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border text-dim hover:text-accent disabled:opacity-40">Export CSV</button>
      </div>
      {!rows.length ? <div className="flex items-center justify-center h-16 text-dim text-xs">No activity yet</div> : (
        <table className="w-full text-xs min-w-[640px]">
          <thead className="sticky top-0 bg-bg"><tr className="border-b border-border">
            {[`Time (${times.zone(Date.now() / 1000)})`, 'Action', 'Option', 'Amount', 'Realised', ''].map(h => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-dim">{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(a => {
              const pnl = ['EXERCISE', 'SELL_BACK', 'REFUND'].includes(a.kind) && a.option ? pnlById[a.option.id] : null;
              return (
                <tr key={a.id} className="border-b border-border hover:bg-surface/50">
                  <td className="px-3 py-2 font-mono text-dim">{times.label(Number(a.timestamp))}</td>
                  <td className="px-3 py-2">{KIND[a.kind] || a.kind}</td>
                  <td className="px-3 py-2 font-mono">{a.option ? <span className={a.option.optionType === 'CALL' ? 'text-accent' : 'text-red'}>{optName(a.option)}</span> : '—'}</td>
                  <td className="px-3 py-2 font-mono">{money(Number(a.amount))}{a.shares != null && Number(a.shares) > 0 ? <span className="text-dim"> · {money(Number(a.shares))} yMUSD</span> : ''}</td>
                  <td className={`px-3 py-2 font-mono ${pnl == null ? 'text-dim' : pnl >= 0 ? 'text-accent' : 'text-red'}`}>{pnl == null ? '' : signed(pnl)}</td>
                  <td className="px-3 py-2"><a href={explorerTx(network, a.tx)} target="_blank" rel="noreferrer" className="text-dim hover:text-accent">tx ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function YourOrders() {
  const { account, poolContract, btcPrice, options, poolParams, ordersLoading, refresh, history, historyLoading, network } = useStore(useShallow(s => ({
    account: s.account, poolContract: s.poolContract, btcPrice: s.btcPrice, options: s.options, poolParams: s.poolParams,
    ordersLoading: s.ordersLoading, refresh: s.refresh, history: s.history, historyLoading: s.historyLoading, network: s.network,
  })));
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('pos') === 'history' ? 'history' : 'active'));
  const now = Math.floor(Date.now() / 1000);

  const mine = useMemo(() => options.filter(o =>
    o.long?.toLowerCase() === account?.toLowerCase() || o.short?.toLowerCase() === account?.toLowerCase()), [options, account]);
  const active = mine.filter(o => o.status === STATUS.OPEN || o.status === STATUS.FILLED);
  const closed = mine.filter(o => o.status === STATUS.SETTLED || o.status === STATUS.REFUNDED || o.status === STATUS.CLOSED);
  const iv = poolParams?.iv || 0.8;
  const { totals } = useMemo(() => livePositions(options, account, btcPrice, iv, now), [options, account, btcPrice, iv, Math.floor(now / 15)]); // eslint-disable-line
  // history comes from the subgraph; if it is unavailable, show ended options read from the chain instead
  const list = (tab === 'active' ? active : closed).slice().sort((a, b) => Number(b.id - a.id));
  const showSubgraphHistory = tab === 'history' && history;

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
      {account && tab === 'active' && (totals.premiumAtRisk > 0 || totals.collateralLocked > 0) && <Totals t={totals} />}
      <div className="flex-1 overflow-auto min-h-0">
        {!account ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">Connect your wallet to see positions</div>
        ) : showSubgraphHistory ? (
          <HistoryTab history={history} account={account} network={network} unrealised={totals.pnl} />
        ) : tab === 'history' && historyLoading ? (
          <div>{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : ordersLoading ? (
          <div>{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
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
      {account && tab === 'active' && list.length > 0 && <p className="px-4 py-1.5 text-[10px] text-dim/60 border-t border-border">Entry and mark are MUSD per 1 BTC. Mark uses the pool's mid volatility; Sell back pays the pool's bid, a little under mark. Click a row for the payoff at expiry.</p>}
      {account && tab === 'history' && !history && !historyLoading && <p className="px-4 py-1.5 text-[10px] text-dim/60 border-t border-border">History service unavailable: showing ended options read from the chain (no P&L).</p>}
    </div>
  );
}
