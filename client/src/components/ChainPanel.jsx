import React, { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useNow } from '../useNow';
import { expirySlots, extraExpiries, expiryLabel, strikeLadder, atmStrike, bestQuotes } from '../instruments.mjs';
import { poolWontFill, fmtDuration } from '../poolRules.mjs';
import { greeks } from '../greeks';

const money = v => v == null ? '—' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** One price cell. Clicking an ask means "buy this", clicking a bid means "sell into this". */
function Cell({ value, tone, pool, active, onClick, title }) {
  if (value == null) return <td className="px-2 py-1 text-right text-dim/40 font-mono">—</td>;
  return (
    <td className="p-0">
      <button type="button" onClick={onClick} title={title}
        className={`w-full px-2 py-1 text-right font-mono transition-colors hover:bg-white/5 ${tone} ${active ? 'bg-white/10' : ''}`}>
        {money(value)}{pool && <span className="ml-1 text-[8px] text-accent/70" aria-label="pool price">●</span>}
      </button>
    </td>
  );
}

/**
 * Options chain: pick an expiry, then a strike. Calls on the left, puts on the right (like an exchange).
 * Ask = cheapest of the pool's price and users' resting sell orders. Bid = best resting buy order.
 */
export default function ChainPanel() {
  const { btcPrice: spot, options, poolParams, chain, selected, setSelected, fetchChain, ordersLoading } = useStore();
  const now = useNow(30_000);

  const slots = useMemo(() => expirySlots(now), [Math.floor(now / 600)]); // eslint-disable-line
  const expiries = useMemo(() => [...slots, ...extraExpiries(options, slots, now)].sort((a, b) => a - b), [slots, options, now]);
  const expiry = selected?.expiry && expiries.includes(selected.expiry)
    ? selected.expiry
    : (expiries.find(t => t - now >= 20 * 3600) || expiries[0]);

  const withOrders = useMemo(() => options.filter(o => Number(o.expiry) === expiry && Number(o.status) === 0)
    .map(o => Math.round(Number(o.strike) / 1e18)), [options, expiry]);
  const strikes = useMemo(() => strikeLadder(spot, withOrders), [Math.round(spot / 500), withOrders.join(',')]); // eslint-disable-line
  const atm = atmStrike(strikes, spot);
  const book = useMemo(() => bestQuotes(options, expiry), [options, expiry]);

  // Pool prices come from the contract itself; refresh while the chain is visible
  const key = `${expiry}|${strikes.join(',')}`;
  useEffect(() => {
    if (!expiry || !strikes.length) return;
    fetchChain(expiry, strikes);
    const id = setInterval(() => fetchChain(expiry, strikes), 15_000);
    return () => clearInterval(id);
  }, [key]); // eslint-disable-line

  const prices = chain && chain.expiry === expiry ? chain.byStrike : {};
  const iv = poolParams?.iv || 0.8;
  const hours = Math.max(0, (expiry - now) / 3600);
  const secs = expiry - now;

  const poolOk = k => poolParams ? poolWontFill({ spot, strike: k, expirySecs: secs, nowSec: now }, poolParams).length === 0 : true;
  const askOf = (k, side) => {
    const pool = poolOk(k) ? prices[k]?.[side] ?? null : null;
    const user = book[k]?.[side]?.ask ?? null;
    if (pool == null && user == null) return { value: null };
    if (user != null && (pool == null || user < pool)) return { value: user, pool: false };
    return { value: pool, pool: true };
  };
  const pick = (k, isCall, side) => setSelected({ isCall, strike: k, expiry, side });
  const isSel = (k, isCall) => selected && selected.strike === k && selected.isCall === isCall && selected.expiry === expiry;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto shrink-0" role="tablist" aria-label="Expiry">
        {expiries.map(t => (
          <button key={t} role="tab" aria-selected={t === expiry}
            onClick={() => setSelected(selected ? { ...selected, expiry: t } : { isCall: true, strike: atm, expiry: t, side: 'buy' })}
            className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-mono leading-tight text-left transition-colors ${t === expiry ? 'bg-accent/15 text-accent' : 'text-dim hover:text-text'}`}>
            <div>{expiryLabel(t)}</div>
            <div className="text-[9px] opacity-70">{fmtDuration(t - now).replace(/ \d+s$/, '')}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-dim shrink-0">
        <span>MUSD per 1 BTC option · pool price for a 0.01 BTC order (bigger orders cost more) <span className="text-accent/70">●</span> = pool</span>
        {poolParams && <span className="font-mono">Pool IV (ask) {(poolParams.askIv * 100).toFixed(1)}%</span>}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {!strikes.length || !spot ? (
          <div className="flex items-center justify-center h-24 text-dim text-xs">{ordersLoading ? 'Loading…' : 'Waiting for the BTC price…'}</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="text-[10px] uppercase tracking-wider text-dim">
                <th colSpan={3} className="py-1 text-accent/80 font-display">Calls</th>
                <th className="py-1">Strike</th>
                <th colSpan={3} className="py-1 text-red/80 font-display">Puts</th>
              </tr>
              <tr className="text-[10px] text-dim border-b border-border">
                <th className="text-right px-2 py-1 font-normal">Δ</th>
                <th className="text-right px-2 py-1 font-normal">Bid</th>
                <th className="text-right px-2 py-1 font-normal">Ask</th>
                <th />
                <th className="text-right px-2 py-1 font-normal">Bid</th>
                <th className="text-right px-2 py-1 font-normal">Ask</th>
                <th className="text-right px-2 py-1 font-normal">Δ</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map(k => {
                const ca = askOf(k, 'call'), pa = askOf(k, 'put');
                const gc = greeks(true, spot, k, hours, iv), gp = greeks(false, spot, k, hours, iv);
                const itmCall = k < spot, itmPut = k > spot;
                return (
                  <tr key={k} className={`border-b border-border/50 ${k === atm ? 'border-y border-y-accent/30' : ''}`}>
                    <td className={`px-2 py-1 text-right font-mono text-dim ${itmCall ? 'bg-accent/5' : ''}`}>{gc.delta ?? '—'}</td>
                    <Cell value={book[k]?.call?.bid} tone="text-accent" active={isSel(k, true) && selected.side === 'sell'} onClick={() => pick(k, true, 'sell')} title="Best buyer: click to sell" />
                    <Cell value={ca.value} pool={ca.pool} tone="text-text" active={isSel(k, true) && selected.side === 'buy'} onClick={() => pick(k, true, 'buy')} title="Click to buy" />
                    <td className="px-2 py-1 text-center font-mono font-semibold text-text bg-surface">{k.toLocaleString()}{k === atm && <span className="ml-1 text-[9px] text-accent">ATM</span>}</td>
                    <Cell value={book[k]?.put?.bid} tone="text-accent" active={isSel(k, false) && selected.side === 'sell'} onClick={() => pick(k, false, 'sell')} title="Best buyer: click to sell" />
                    <Cell value={pa.value} pool={pa.pool} tone="text-text" active={isSel(k, false) && selected.side === 'buy'} onClick={() => pick(k, false, 'buy')} title="Click to buy" />
                    <td className={`px-2 py-1 text-right font-mono text-dim ${itmPut ? 'bg-red/5' : ''}`}>{gp.delta ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
