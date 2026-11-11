import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getNetwork } from '../network.mjs';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Flash } from './Live';
import { useNow } from '../useNow';
import { useTimes } from '../useTimes';
import { expirySlots, extraExpiries, strikeLadder, atmStrike, bestQuotes } from '../instruments.mjs';
import { poolWontFill, fmtDuration } from '../poolRules.mjs';
import { openInterest, volume24h, inUnit, fmtUnit } from '../market.mjs';
import { greeks, bsPrice, impliedVol } from '../greeks';

// Columns a user can show or hide. Order is from the outside of the table in towards the strike.
const COLUMNS = [
  { key: 'oi',    label: 'OI',    title: 'Open interest: size of live options at this strike (BTC)' },
  { key: 'vol',   label: '24h',   title: 'Size traded in the last 24 hours (BTC)' },
  { key: 'vega',  label: 'Vega',  title: 'MUSD change per 1 BTC option for a 1-point rise in volatility' },
  { key: 'gamma', label: 'Γ',     title: 'Change in delta for a 1 USD move in BTC' },
  { key: 'theta', label: 'Θ/day', title: 'MUSD lost per day per 1 BTC option from time passing' },
  { key: 'delta', label: 'Δ',     title: 'Price change per 1 USD move in BTC' },
  { key: 'iv',    label: 'IV',    title: 'Implied volatility of the ask price' },
  { key: 'mark',  label: 'Mark',  title: "Fair value at the pool's mid volatility" },
  { key: 'bid',   label: 'Bid',   title: 'Best buyer: click to sell' },
  { key: 'ask',   label: 'Ask',   title: 'Cheapest seller (pool or trader): click to buy' },
];
const DEFAULT_COLS = ['oi', 'delta', 'iv', 'bid', 'ask'];
const COLS_KEY = 'piton_chain_cols';
const UNITS = [['musd', 'MUSD'], ['btc', 'BTC'], ['pct', '% spot']];
const RANGES = [10, 20, 30];

const loadCols = () => {
  try { const v = JSON.parse(localStorage.getItem(COLS_KEY)); if (Array.isArray(v) && v.length) return v; } catch { /* ignore */ }
  return DEFAULT_COLS;
};
const sz = v => (v > 0 ? (v < 0.001 ? v.toFixed(4) : v.toFixed(3)) : '');

function PriceCell({ value, unit, spot, tone, pool, active, onClick, title }) {
  const shown = inUnit(value, spot, unit);
  if (shown == null) return <td className="px-2 py-1 text-right text-dim/40 font-mono">—</td>;
  return (
    <td className="p-0">
      <button type="button" onClick={onClick} title={title}
        className={`w-full px-2 py-1 text-right font-mono transition-colors hover:bg-white/5 ${tone} ${active ? 'bg-white/10' : ''}`}>
        <Flash value={value}>{fmtUnit(shown, unit)}</Flash>{pool && <span className="ml-1 text-[8px] text-accent/70" aria-label="pool price">●</span>}
      </button>
    </td>
  );
}

/** Open interest with a bar behind it, so concentrations stand out. */
function OiCell({ value, max, tone }) {
  const w = max > 0 && value > 0 ? Math.max(4, Math.round(value / max * 100)) : 0;
  return (
    <td className="px-2 py-1 text-right font-mono text-dim relative">
      {w > 0 && <span className={`absolute inset-y-1 right-0 ${tone} rounded-sm`} style={{ width: `${w}%` }} aria-hidden="true" />}
      <span className="relative">{sz(value) || '—'}</span>
    </td>
  );
}

const plain = (v, tone = 'text-dim') => <td className={`px-2 py-1 text-right font-mono ${tone}`}>{v == null || Number.isNaN(v) ? '—' : v}</td>;

/**
 * Options chain: pick an expiry, then a strike. Calls on the left, puts on the right (like an exchange).
 * Ask = cheapest of the pool's price and users' resting sell orders. Bid = best resting buy order.
 */
export default function ChainPanel() {
  const { btcPrice: spot, options, trades, poolParams, chain, selected, setSelected, fetchChain, ordersLoading } = useStore(useShallow(s => ({ btcPrice: s.btcPrice, options: s.options, trades: s.trades, poolParams: s.poolParams, chain: s.chain, selected: s.selected, setSelected: s.setSelected, fetchChain: s.fetchChain, ordersLoading: s.ordersLoading })));
  const now = useNow(30_000);
  const times = useTimes();
  const [cols, setCols] = useState(loadCols);
  const prefUnit = useStore(s => s.settings.priceUnit);
  const [unit, setUnit] = useState(() => localStorage.getItem('piton_chain_unit') || prefUnit || 'musd');
  useEffect(() => { if (prefUnit) setUnit(prefUnit); }, [prefUnit]); // a new default in Settings applies at once
  const [range, setRange] = useState(20);
  const [view, setView] = useState('both');
  const [menu, setMenu] = useState(false);
  const scroller = useRef(null);
  const atmRow = useRef(null);

  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]);
  useEffect(() => { try { localStorage.setItem('piton_chain_unit', unit); } catch { /* ignore */ } }, [unit]);

  const expCfg = useStore(s => getNetwork(s.network).expiries);
  const slots = useMemo(() => expirySlots(now, expCfg), [Math.floor(now / 300), expCfg]); // eslint-disable-line
  const expiries = useMemo(() => [...slots, ...extraExpiries(options, slots, now)].sort((a, b) => a - b), [slots, options, now]);
  const expiry = selected?.expiry && expiries.includes(selected.expiry)
    ? selected.expiry
    : (expiries.find(t => t - now >= 20 * 3600) || expiries[0]);

  const withOrders = useMemo(() => options.filter(o => Number(o.expiry) === expiry && (Number(o.status) === 0 || Number(o.status) === 1))
    .map(o => Math.round(Number(o.strike) / 1e18)), [options, expiry]);
  const strikes = useMemo(() => strikeLadder(spot, withOrders, range), [Math.round(spot / 500), withOrders.join(','), range]); // eslint-disable-line
  const atm = atmStrike(strikes, spot);
  const book = useMemo(() => bestQuotes(options, expiry), [options, expiry]);
  const oi = useMemo(() => openInterest(options, now, expiry), [options, now, expiry]);
  const vol = useMemo(() => volume24h(trades, options, now, expiry), [trades, options, now, expiry]);
  const maxOi = useMemo(() => Math.max(0, ...Object.values(oi.byStrike).flatMap(c => [c.call, c.put])), [oi]);

  // Pool prices come from the contract itself; refresh while the chain is visible
  const key = `${expiry}|${strikes.join(',')}`;
  // pool prices for every visible strike: one batched read, refreshed on each new block (about every 4s)
  const blockNo = useStore(s => s.block?.number);
  useEffect(() => {
    if (!expiry || !strikes.length) return;
    fetchChain(expiry, strikes);
  }, [key, blockNo]); // eslint-disable-line

  // keep the at-the-money row in view when the expiry or range changes
  useEffect(() => {
    const box = scroller.current, row = atmRow.current;
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2 + row.clientHeight);
  }, [expiry, range, view, strikes.length > 0]); // eslint-disable-line

  const prices = chain && chain.expiry === expiry ? chain.byStrike : {};
  const midIv = poolParams?.iv || 0.8;
  const hours = Math.max(0, (expiry - now) / 3600);
  const secs = expiry - now;

  const poolOk = k => (poolParams ? poolWontFill({ spot, strike: k, expirySecs: secs, nowSec: now }, poolParams).length === 0 : true);
  const askOf = (k, side) => {
    const pool = poolOk(k) ? prices[k]?.[side] ?? null : null;
    const user = book[k]?.[side]?.ask ?? null;
    if (pool == null && user == null) return { value: null };
    if (user != null && (pool == null || user < pool)) return { value: user, pool: false };
    return { value: pool, pool: true };
  };
  const pick = (k, isCall, side) => setSelected({ isCall, strike: k, expiry, side });
  const isSel = (k, isCall) => selected && selected.strike === k && selected.isCall === isCall && selected.expiry === expiry;

  // Keyboard trading (when not typing in a field): up/down = strike, left = call, right = put,
  // B = buy, S = sell, Enter = review the order in the trade form.
  const keyState = useRef({});
  keyState.current = { selected, strikes, expiry, atm };
  useEffect(() => {
    const onKey = e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"], .fixed.inset-0')) return; // not while a dialog is open
      const { selected: sel, strikes: ks, expiry: ex, atm: a } = keyState.current;
      if (!ks.length) return;
      const cur = sel && sel.expiry === ex ? sel : { isCall: true, strike: a, expiry: ex, side: 'buy' };
      const i = Math.max(0, ks.indexOf(cur.strike));
      let next = null;
      if (e.key === 'ArrowUp') next = { ...cur, strike: ks[Math.max(0, i - 1)] };
      else if (e.key === 'ArrowDown') next = { ...cur, strike: ks[Math.min(ks.length - 1, i + 1)] };
      else if (e.key === 'ArrowLeft') next = { ...cur, isCall: true };
      else if (e.key === 'ArrowRight') next = { ...cur, isCall: false };
      else if (e.key === 'b' || e.key === 'B') next = { ...cur, side: 'buy' };
      else if (e.key === 's' || e.key === 'S') next = { ...cur, side: 'sell' };
      else if (e.key === 'Enter' && sel) { e.preventDefault(); useStore.getState().requestReview(); return; }
      if (!next) return;
      e.preventDefault();
      setSelected(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  // keep the selected row visible while moving with the keyboard
  useEffect(() => {
    const box = scroller.current, row = box?.querySelector(`[data-strike="${selected?.strike}"]`);
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop + 40 || row.offsetTop > box.scrollTop + box.clientHeight - 30) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }, [selected?.strike]);

  const shown = COLUMNS.filter(c => cols.includes(c.key));
  const toggle = k => setCols(c => (c.includes(k) ? (c.length > 1 ? c.filter(x => x !== k) : c) : [...c, k]));

  // One side of a row. `mirror` reverses column order for the puts side, so bid/ask sit next to the strike.
  const sideCells = (k, isCall) => {
    const side = isCall ? 'call' : 'put';
    const a = askOf(k, side);
    const g = greeks(isCall, spot, k, hours, midIv);
    const mark = bsPrice(isCall, spot, k, hours, midIv);
    const iv = a.value != null ? impliedVol(isCall, spot, k, hours, a.value) : null;
    const tone = isCall ? 'bg-accent/15' : 'bg-red/15';
    const cells = {
      oi: <OiCell key="oi" value={oi.byStrike[k]?.[side] || 0} max={maxOi} tone={tone} />,
      vol: plain(sz(vol.byStrike[k]?.[side] || 0) || '—'),
      vega: plain(g.vega != null ? g.vega.toFixed(1) : null),
      gamma: plain(g.gamma != null ? g.gamma.toExponential(1) : null),
      theta: plain(g.theta != null ? g.theta.toFixed(0) : null),
      delta: plain(g.delta),
      iv: plain(iv != null ? `${(iv * 100).toFixed(1)}%` : null, 'text-text/80'),
      mark: <PriceCell key="mark" value={mark} unit={unit} spot={spot} tone="text-dim" onClick={() => pick(k, isCall, 'buy')} title="Fair value at the pool's mid volatility" />,
      bid: <PriceCell key="bid" value={book[k]?.[side]?.bid} unit={unit} spot={spot} tone="text-accent" active={isSel(k, isCall) && selected.side === 'sell'} onClick={() => pick(k, isCall, 'sell')} title="Best buyer: click to sell" />,
      ask: <PriceCell key="ask" value={a.value} pool={a.pool} unit={unit} spot={spot} tone="text-text" active={isSel(k, isCall) && selected.side === 'buy'} onClick={() => pick(k, isCall, 'buy')} title="Click to buy" />,
    };
    const list = shown.map(c => React.cloneElement(cells[c.key], { key: c.key }));
    return isCall ? list : [...list].reverse();
  };
  const headCells = isCall => {
    const list = shown.map(c => <th key={c.key} title={c.title} className="text-right px-2 py-1 font-normal">{c.label}</th>);
    return isCall ? list : [...list].reverse();
  };
  const showCalls = view !== 'puts', showPuts = view !== 'calls';

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto shrink-0" role="tablist" aria-label={`Expiry, times in ${times.zone(now)}`}>
        <span className="shrink-0 text-[9px] font-mono text-dim pr-1 leading-tight" title="Change in Settings: Times">{times.zone(now)}</span>
        {expiries.map(t => (
          <button key={t} role="tab" aria-selected={t === expiry} title={times.title(t)}
            onClick={() => setSelected(selected ? { ...selected, expiry: t } : { isCall: true, strike: atm, expiry: t, side: 'buy' })}
            className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-mono leading-tight text-left transition-colors ${t === expiry ? 'bg-accent/15 text-accent' : 'text-dim hover:text-text'}`}>
            <div>{times.label(t)}</div>
            <div className="text-[9px] opacity-70">{fmtDuration(t - now).replace(/ \d+s$/, '')}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[10px] text-dim shrink-0 border-b border-border/60">
        <div className="flex rounded border border-border overflow-hidden" role="group" aria-label="Price unit">
          {UNITS.map(([k, l]) => <button key={k} onClick={() => setUnit(k)} aria-pressed={unit === k} className={`px-2 py-0.5 ${unit === k ? 'bg-surface text-text' : ''}`}>{l}</button>)}
        </div>
        <div className="flex rounded border border-border overflow-hidden" role="group" aria-label="Show">
          {[['both', 'Both'], ['calls', 'Calls'], ['puts', 'Puts']].map(([k, l]) => <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`px-2 py-0.5 ${view === k ? 'bg-surface text-text' : ''}`}>{l}</button>)}
        </div>
        <div className="flex rounded border border-border overflow-hidden" role="group" aria-label="Strike range">
          {RANGES.map(r => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={`px-2 py-0.5 ${range === r ? 'bg-surface text-text' : ''}`}>±{r}%</button>)}
        </div>
        <div className="relative">
          <button onClick={() => setMenu(m => !m)} aria-expanded={menu} className="px-2 py-0.5 rounded border border-border hover:text-text">Columns ▾</button>
          {menu && (
            <div className="absolute z-20 mt-1 bg-panel border border-border rounded-md p-2 space-y-1 shadow-lg min-w-[180px]" onMouseLeave={() => setMenu(false)}>
              {COLUMNS.map(c => (
                <label key={c.key} className="flex items-center gap-2 text-xs text-text cursor-pointer" title={c.title}>
                  <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggle(c.key)} />{c.label} <span className="text-dim text-[10px]">{c.title.split(':')[0]}</span>
                </label>
              ))}
              <button onClick={() => setCols(DEFAULT_COLS)} className="text-[10px] text-accent">Reset</button>
            </div>
          )}
        </div>
        <span className="ml-auto">
          Price per 1 BTC option · pool price for 0.01 BTC <span className="text-accent/70">●</span>
          {poolParams && <span className="font-mono"> · pool IV {(poolParams.iv * 100).toFixed(1)}% mid</span>}
        </span>
      </div>

      <div ref={scroller} className="flex-1 overflow-auto min-h-0 relative">
        {!strikes.length || !spot ? (
          <div className="flex items-center justify-center h-24 text-dim text-xs">{ordersLoading ? 'Loading…' : 'Waiting for the BTC price…'}</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="text-[10px] uppercase tracking-wider text-dim">
                {showCalls && <th colSpan={shown.length} className="py-1 text-accent/80 font-display">Calls</th>}
                <th className="py-1">Strike</th>
                {showPuts && <th colSpan={shown.length} className="py-1 text-red/80 font-display">Puts</th>}
              </tr>
              <tr className="text-[10px] text-dim border-b border-border">
                {showCalls && headCells(true)}
                <th />
                {showPuts && headCells(false)}
              </tr>
            </thead>
            <tbody>
              {strikes.map(k => (
                <tr key={k} ref={k === atm ? atmRow : null} data-strike={k}
                  className={`border-b border-border/50 ${k === atm ? 'border-y border-y-accent/30' : ''}`}>
                  {showCalls && sideCells(k, true).map((c, i) => <React.Fragment key={`c${i}`}>{k < spot ? React.cloneElement(c, { className: `${c.props.className || ''} bg-accent/[0.04]` }) : c}</React.Fragment>)}
                  <td className="px-2 py-1 text-center font-mono font-semibold text-text bg-surface whitespace-nowrap">{k.toLocaleString()}{k === atm && <span className="ml-1 text-[9px] text-accent">ATM</span>}</td>
                  {showPuts && sideCells(k, false).map((c, i) => <React.Fragment key={`p${i}`}>{k > spot ? React.cloneElement(c, { className: `${c.props.className || ''} bg-red/[0.04]` }) : c}</React.Fragment>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
