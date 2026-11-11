import React, { useEffect, useRef, useState } from 'react';
import { LineSeries, LineType } from 'lightweight-charts';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { makeChart, COLORS } from '../chartTheme';
import { ivSteps, parseDvol } from '../chartMath.mjs';

const RANGES = [['7d', 7], ['30d', 30]];

/** Pool mid and ask volatility (from the subgraph's IV updates) against Deribit's DVOL index. */
export default function VolChart({ utc }) {
  const { poolParams, querySubgraph, network } = useStore(useShallow(s => ({ poolParams: s.poolParams, querySubgraph: s.querySubgraph, network: s.network })));
  const box = useRef(null);
  const chart = useRef(null);
  const s = useRef({});
  const [days, setDays] = useState(7);
  const [note, setNote] = useState('Loading…');

  useEffect(() => {
    const c = makeChart(box.current, { utc, priceFormatter: v => `${v.toFixed(1)}%` });
    s.current = {
      dvol: c.addSeries(LineSeries, { color: '#7aa2ff', lineWidth: 1, title: 'DVOL', priceLineVisible: false }),
      mid: c.addSeries(LineSeries, { color: COLORS.up, lineWidth: 2, lineType: LineType.WithSteps, title: 'Pool mid', priceLineVisible: false }),
      ask: c.addSeries(LineSeries, { color: COLORS.strike, lineWidth: 1, lineType: LineType.WithSteps, title: 'Pool ask', priceLineVisible: false }),
    };
    chart.current = c;
    return () => c.remove();
  }, [utc]);

  useEffect(() => {
    let off = false;
    (async () => {
      setNote('Loading…');
      const now = Math.floor(Date.now() / 1000), from = now - days * 86400;
      const [sub, dv] = await Promise.all([
        querySubgraph('{ ivUpdates(first: 1000, orderBy: timestamp, orderDirection: asc) { timestamp iv } }'),
        fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${from * 1000}&end_timestamp=${now * 1000}&resolution=3600`)
          .then(r => r.json()).catch(() => null),
      ]);
      if (off) return;
      const ratio = poolParams?.iv > 0 ? poolParams.askIv / poolParams.iv : 1;
      const steps = ivSteps(sub?.ivUpdates || [], now, ratio);
      const dvol = parseDvol(dv).filter(p => p.time >= from);
      s.current.mid.setData(steps.mid); s.current.ask.setData(steps.ask); s.current.dvol.setData(dvol);
      chart.current.timeScale().fitContent();
      const parts = [];
      if (!sub) parts.push('subgraph unavailable: pool IV history not shown');
      else if (!steps.mid.length) parts.push('no pool IV updates yet');
      else parts.push(`pool IV since ${new Date(steps.mid[0].time * 1000).toUTCString().slice(5, 22)} UTC (this pool's deployment)`);
      if (!dvol.length) parts.push('DVOL unavailable');
      setNote(parts.join(' · '));
    })();
    return () => { off = true; };
  }, [days, network, utc, poolParams?.iv, poolParams?.askIv]); // eslint-disable-line

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-dim border-b border-border/60 shrink-0">
        <span><span style={{ color: COLORS.up }}>━</span> pool mid IV</span>
        <span><span style={{ color: COLORS.strike }}>━</span> pool ask IV (what buyers pay)</span>
        <span><span style={{ color: '#7aa2ff' }}>━</span> Deribit DVOL</span>
        <span className="ml-auto truncate">{note}</span>
        <div className="flex gap-0.5" role="group" aria-label="Range">
          {RANGES.map(([l, d]) => <button key={l} aria-pressed={days === d} onClick={() => setDays(d)} className={`px-2 py-0.5 rounded font-mono ${days === d ? 'bg-surface text-text' : 'hover:text-text'}`}>{l}</button>)}
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={box} className="absolute inset-0" />
        {note === 'Loading…' && <div className="absolute inset-0 flex items-center justify-center text-dim text-xs pointer-events-none">Loading…</div>}
        {/unavailable|no pool/.test(note) && <div className="absolute inset-0 flex items-center justify-center text-dim text-xs pointer-events-none text-center px-6">{note}</div>}
      </div>
    </div>
  );
}
