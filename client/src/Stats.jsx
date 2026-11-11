import React, { useEffect, useRef, useState } from 'react';
import { HistogramSeries, AreaSeries } from 'lightweight-charts';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store';
import { getNetwork } from './network.mjs';
import { makeChart, COLORS } from './chartTheme';
import Navbar from './components/Navbar';

const n = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

function Kpi({ label, value, sub }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-dim">{label}</div>
      <div className="font-mono text-xl text-text mt-1">{value}</div>
      {sub && <div className="text-[11px] text-dim mt-0.5">{sub}</div>}
    </div>
  );
}

/** Daily bars (premium volume) and a line (pool assets) from the subgraph's daily snapshots. */
function DailyChart({ days }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current || !days.length) return undefined;
    const c = makeChart(box.current, { utc: true });
    c.applyOptions({ leftPriceScale: { visible: true }, timeScale: { timeVisible: false } });
    const vol = c.addSeries(HistogramSeries, { priceScaleId: 'right', color: 'rgba(0,255,136,0.6)', title: 'Premium volume (MUSD)', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    const tvl = c.addSeries(AreaSeries, { priceScaleId: 'left', lineColor: 'rgba(122,162,255,0.9)', topColor: 'rgba(122,162,255,0.2)', bottomColor: 'rgba(122,162,255,0.02)', lineWidth: 1, title: 'Pool assets', priceFormat: { type: 'price', precision: 0, minMove: 1 } });
    vol.setData(days.map(d => ({ time: Number(d.periodStart), value: Number(d.volumePremium) })));
    tvl.setData(days.map(d => ({ time: Number(d.periodStart), value: Number(d.totalAssets) })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [days]);
  return <div ref={box} className="h-72" />;
}

/** All-time protocol statistics for the selected network, from the Goldsky subgraph. Shareable at /stats. */
export default function Stats() {
  const { network, querySubgraph } = useStore(useShallow(s => ({ network: s.network, querySubgraph: s.querySubgraph })));
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  const net = getNetwork(network);

  useEffect(() => {
    let off = false;
    setD(null); setErr(false);
    (async () => {
      const r = await querySubgraph(`{
        pool(id: "pool") { totalAssets lockedCollateral sharePrice iv tradeCount volumeQuantity volumePremium payouts breakerTrips openPoolOptions }
        poolDaySnapshots(first: 1000, orderBy: periodStart, orderDirection: asc) { periodStart trades volumeQuantity volumePremium payouts deposits withdrawals totalAssets sharePrice }
        accounts(first: 1000) { id tradeCount deposited }
        options(first: 1000) { status filledByPool }
        first: activities(first: 1, orderBy: timestamp, orderDirection: asc) { timestamp }
      }`);
      if (off) return;
      if (!r) { setErr(true); return; }
      setD(r);
    })();
    return () => { off = true; };
  }, [network]); // eslint-disable-line

  const p = d?.pool;
  const traders = d ? d.accounts.filter(a => a.tradeCount > 0).length : null;
  const lps = d ? d.accounts.filter(a => Number(a.deposited) > 0).length : null;
  const filled = d ? d.options.filter(o => o.status !== 'OPEN' && o.status !== 'CANCELLED').length : null;
  const byPool = d ? d.options.filter(o => o.filledByPool).length : null;
  const since = d?.first?.[0] ? new Date(Number(d.first[0].timestamp) * 1000).toUTCString().slice(5, 16) : null;
  const net30 = p ? Number(p.volumePremium) - Number(p.payouts) : null;

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="font-display text-xl text-text">Piton statistics <span className="text-dim text-sm">· {net.label}</span></h1>
          <span className="text-[11px] text-dim">{since ? `All time, since ${since} (current pool deployment)` : ''}{net.isTestnet ? ' · testnet, includes test and seeded demo activity' : ''}</span>
        </div>
        {err && <div className="panel px-4 py-6 text-center text-dim text-sm">Statistics are unavailable (the indexer did not respond). Try again shortly.</div>}
        {!d && !err && <div className="panel px-4 py-6 text-center text-dim text-sm">Loading…</div>}
        {d && <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Premium volume" value={`${n(p?.volumePremium, 2)} MUSD`} sub={`${n(p?.volumeQuantity, 4)} BTC of options`} />
            <Kpi label="Trades" value={n(p?.tradeCount)} sub={`${n(byPool)} sold by the pool`} />
            <Kpi label="Traders / LPs" value={`${n(traders)} / ${n(lps)}`} sub="unique wallets" />
            <Kpi label="Pool assets" value={`${n(p?.totalAssets, 2)} MUSD`} sub={`share price ${Number(p?.sharePrice || 1).toFixed(4)}`} />
            <Kpi label="Paid out to buyers" value={`${n(p?.payouts, 2)} MUSD`} sub="exercises and sell-backs" />
            <Kpi label="Premium minus payouts" value={`${n(net30, 2)} MUSD`} sub="before fees, all time" />
            <Kpi label="Options filled" value={n(filled)} sub={`${n(p?.openPoolOptions)} pool options open now`} />
            <Kpi label="Pool IV / breaker trips" value={`${(Number(p?.iv || 0) * 100).toFixed(1)}% / ${n(p?.breakerTrips)}`} sub="current mid volatility" />
          </div>
          <div className="panel">
            <div className="panel-header">Daily premium volume and pool assets (UTC days)</div>
            {d.poolDaySnapshots.length ? <DailyChart days={d.poolDaySnapshots} /> : <p className="px-4 py-6 text-dim text-xs">No daily data yet.</p>}
          </div>
          <div className="panel overflow-x-auto">
            <div className="panel-header">By day</div>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">{['Day (UTC)', 'Trades', 'Size (BTC)', 'Premium', 'Payouts', 'Deposits', 'Withdrawals', 'Pool assets'].map(h => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-dim">{h}</th>)}</tr></thead>
              <tbody>
                {[...d.poolDaySnapshots].reverse().map(r => (
                  <tr key={r.periodStart} className="border-b border-border/50 font-mono">
                    <td className="px-3 py-1.5">{new Date(Number(r.periodStart) * 1000).toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-1.5">{r.trades}</td><td className="px-3 py-1.5">{n(r.volumeQuantity, 4)}</td>
                    <td className="px-3 py-1.5">{n(r.volumePremium, 2)}</td><td className="px-3 py-1.5">{n(r.payouts, 2)}</td>
                    <td className="px-3 py-1.5">{n(r.deposits, 2)}</td><td className="px-3 py-1.5">{n(r.withdrawals, 2)}</td><td className="px-3 py-1.5">{n(r.totalAssets, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </div>
    </div>
  );
}
