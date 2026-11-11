import React, { useMemo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Flash } from './Live';
import { useNow } from '../useNow';
import { instrumentName } from '../instruments.mjs';
import { useTimes } from '../useTimes';
import { instrumentStats } from '../orderForm.mjs';
import { greeks, bsPrice, impliedVol } from '../greeks';

const ago = s => /* time since a trade */ { const d = Math.max(0, Math.floor(Date.now() / 1000) - s); return d < 90 ? `${d}s ago` : d < 5400 ? `${Math.round(d / 60)}m ago` : d < 129600 ? `${Math.round(d / 3600)}h ago` : `${Math.round(d / 86400)}d ago`; };
const n = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function countdown(secs) {
  if (secs <= 0) return 'expired';
  const d = Math.floor(secs / 86400), h = Math.floor(secs % 86400 / 3600), m = Math.floor(secs % 3600 / 60), s = Math.floor(secs % 60);
  const p = x => String(x).padStart(2, '0');
  return d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}

function Item({ label, children, title, tone = 'text-text' }) {
  return (
    <div title={title} className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`font-mono text-xs truncate ${tone}`}>{children}</div>
    </div>
  );
}

/**
 * Facts about the selected option: fair value, the volatility in the ask price, all greeks, last trade,
 * 24h size, open interest and a live countdown to expiry. `askPerBtc` is the pool's price for the size
 * in the form (or null).
 */
export default function InstrumentStrip({ inst, askPerBtc }) {
  const { btcPrice: spot, options, trades, poolParams } = useStore(useShallow(s => ({ btcPrice: s.btcPrice, options: s.options, trades: s.trades, poolParams: s.poolParams })));
  const now = useNow(1000);
  const times = useTimes();
  const secs = inst.expiry - now;
  const hours = Math.max(0, secs / 3600);
  const mid = poolParams?.iv || 0.8;
  const mark = spot ? bsPrice(inst.isCall, spot, inst.strike, hours, mid) : null;
  const g = spot ? greeks(inst.isCall, spot, inst.strike, hours, mid) : {};
  const askIv = askPerBtc && spot ? impliedVol(inst.isCall, spot, inst.strike, hours, askPerBtc) : null;
  const itm = spot ? (inst.isCall ? spot > inst.strike : spot < inst.strike) : false;
  const stats = useMemo(() => instrumentStats(options, trades, inst, now), [options, trades, inst, Math.floor(now / 30)]); // eslint-disable-line

  return (
    <div className="bg-surface rounded-md px-3 py-2 space-y-2" aria-label={`Details for ${instrumentName(inst)}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-display font-semibold ${inst.isCall ? 'text-accent' : 'text-red'}`}>
          {inst.isCall ? 'Call' : 'Put'} ${inst.strike.toLocaleString()} <span className={`text-[10px] ${itm ? 'text-accent' : 'text-dim'}`}>{itm ? 'ITM' : 'OTM'}</span>
        </span>
        <span className={`font-mono text-xs ${secs < 3600 ? 'text-yellow-400' : 'text-text'}`} title={`${times.title(inst.expiry)} · ${instrumentName(inst)}`} aria-live="off">
          {times.full(inst.expiry)} · ⏱ {countdown(secs)}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
        <Item label="Mark / BTC" title="Fair value at the pool's mid volatility"><Flash value={mark != null ? Math.round(mark * 100) : null}>{n(mark)}</Flash></Item>
        <Item label="Ask IV" title="Volatility implied by the pool's price for your size">{askIv != null ? `${(askIv * 100).toFixed(1)}%` : '—'}</Item>
        <Item label="Mid IV" title="The pool's mid volatility">{(mid * 100).toFixed(1)}%</Item>
        <Item label="Delta" title="Price change per 1 USD move in BTC">{g.delta ?? '—'}</Item>
        <Item label="Gamma" title="Change in delta per 1 USD move in BTC">{g.gamma != null ? g.gamma.toExponential(2) : '—'}</Item>
        <Item label="Theta / day" title="MUSD lost per day per 1 BTC option">{g.theta ?? '—'}</Item>
        <Item label="Vega" title="MUSD per 1 BTC option for a 1-point rise in volatility">{g.vega ?? '—'}</Item>
        <Item label="Last / BTC" title={stats.last ? `${stats.last.qty} BTC, ${stats.last.byPool ? 'from the pool' : 'between traders'}` : 'No trades in the last ~26 hours'}>
          {stats.last ? <span title={ago(stats.last.time)}>{n(stats.last.price)}</span> : '—'}
        </Item>
        <Item label="24h vol" title="Size traded in the last 24 hours (BTC)">{stats.vol24 > 0 ? n(stats.vol24, 4) : '—'}</Item>
        <Item label="Open int." title="Size of live positions in this option (BTC)">{stats.oi > 0 ? n(stats.oi, 4) : '—'}</Item>
        <Item label="Spot"><Flash value={spot}>{n(spot, 0)}</Flash></Item>
      </div>
    </div>
  );
}
