import React, { useEffect, useRef, useState } from 'react';
import { expiryLabel, zoneLabel } from '../instruments.mjs';
import { AreaSeries, LineSeries } from 'lightweight-charts';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { makeChart, COLORS } from '../chartTheme';
import { uniqueByTime } from '../chartMath.mjs';

/** Pool share price (right axis) and pool assets (left axis) over time, from the subgraph's snapshots. */
export default function PoolChart({ utc }) {
  const { poolParams, poolShareValue, querySubgraph, network } = useStore(useShallow(s => ({ poolParams: s.poolParams, poolShareValue: s.poolShareValue, querySubgraph: s.querySubgraph, network: s.network })));
  const box = useRef(null);
  const chart = useRef(null);
  const s = useRef({});
  const [period, setPeriod] = useState('hour');
  const [note, setNote] = useState('Loading…');

  useEffect(() => {
    const c = makeChart(box.current, { utc });
    c.applyOptions({ leftPriceScale: { visible: true } });
    s.current = {
      assets: c.addSeries(AreaSeries, { priceScaleId: 'left', lineColor: 'rgba(122,162,255,0.8)', topColor: 'rgba(122,162,255,0.25)', bottomColor: 'rgba(122,162,255,0.02)', lineWidth: 1, title: 'Assets', priceFormat: { type: 'price', precision: 0, minMove: 1 } }),
      locked: c.addSeries(LineSeries, { priceScaleId: 'left', color: COLORS.down, lineWidth: 1, title: 'Locked', priceLineVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } }),
      share: c.addSeries(LineSeries, {
        priceScaleId: 'right', color: COLORS.up, lineWidth: 2, title: 'Share price', priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        // keep at least +-0.5% on the axis so a tiny change in share price does not look dramatic
        autoscaleInfoProvider: original => {
          const r = original();
          if (!r?.priceRange) return r;
          const { minValue, maxValue } = r.priceRange, mid = (minValue + maxValue) / 2;
          const half = Math.max((maxValue - minValue) / 2, mid * 0.005);
          return { ...r, priceRange: { minValue: mid - half, maxValue: mid + half } };
        },
      }),
    };
    chart.current = c;
    return () => c.remove();
  }, [utc]);

  useEffect(() => {
    let off = false;
    (async () => {
      setNote('Loading…');
      const entity = period === 'hour' ? 'poolHourSnapshots' : 'poolDaySnapshots';
      const d = await querySubgraph(`{ ${entity}(first: 1000, orderBy: periodStart, orderDirection: asc) { periodStart totalAssets lockedCollateral sharePrice } }`);
      if (off) return;
      const rows = d?.[entity] || [];
      const pts = k => uniqueByTime(rows.map(r => ({ time: Number(r.periodStart), value: Number(r[k]) })));
      const assets = pts('totalAssets'), locked = pts('lockedCollateral'), share = pts('sharePrice');
      // carry the current state to now so the line ends at today's value
      const now = Math.floor(Date.now() / 1000);
      if (assets.length && poolParams && now > assets[assets.length - 1].time) {
        assets.push({ time: now, value: poolParams.totalAssets });
        locked.push({ time: now, value: poolParams.lockedCollateral });
        const sv = parseFloat(poolShareValue);
        if (Number.isFinite(sv)) share.push({ time: now, value: sv });
      }
      s.current.assets.setData(assets); s.current.locked.setData(locked); s.current.share.setData(share);
      chart.current.timeScale().fitContent();
      if (!d) setNote('subgraph unavailable');
      else if (!rows.length) setNote('no pool activity indexed yet');
      else {
        const first = share[0]?.value, last = share[share.length - 1]?.value;
        const chg = first > 0 ? (last / first - 1) * 100 : 0;
        setNote(`share price ${first?.toFixed(4)} → ${last?.toFixed(4)} (${chg >= 0 ? '+' : ''}${chg.toFixed(3)}%) since ${expiryLabel(rows[0].periodStart, utc)} ${zoneLabel(rows[0].periodStart, utc)}. Points are added when the pool has activity; too short a history for a yield figure.`);
      }
    })();
    return () => { off = true; };
  }, [period, network, utc]); // eslint-disable-line

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-dim border-b border-border/60 shrink-0">
        <span><span style={{ color: COLORS.up }}>━</span> share price (right)</span>
        <span><span style={{ color: '#7aa2ff' }}>■</span> assets</span>
        <span><span style={{ color: COLORS.down }}>━</span> locked (left, MUSD)</span>
        <span className="ml-auto truncate" title={note}>{note}</span>
        <div className="flex gap-0.5" role="group" aria-label="Period">
          {[['hour', 'Hourly'], ['day', 'Daily']].map(([k, l]) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)} className={`px-2 py-0.5 rounded font-mono ${period === k ? 'bg-surface text-text' : 'hover:text-text'}`}>{l}</button>)}
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
