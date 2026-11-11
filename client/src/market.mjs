// Market statistics computed from on-chain data the dapp already loads (no indexer).
// options: contract options (BigInt fields). trades: [{ id, time }] from OrderFilled events.

const num = v => (typeof v === 'bigint' ? Number(v) / 1e18 : Number(v));
const live = (o, nowSec) => Number(o.status) === 1 && Number(o.expiry) > nowSec; // FILLED and not expired

/** Open interest: size (BTC) of live filled options, split by calls/puts, plus per-strike for one expiry. */
export function openInterest(options, nowSec, expiry = null) {
  const out = { calls: 0, puts: 0, total: 0, putCallRatio: null, byStrike: {} };
  for (const o of options) {
    if (!live(o, nowSec)) continue;
    const q = num(o.quantity), isCall = Number(o.optionType) === 0;
    if (isCall) out.calls += q; else out.puts += q;
    if (expiry != null && Number(o.expiry) === Number(expiry)) {
      const cell = (out.byStrike[Math.round(num(o.strike))] ||= { call: 0, put: 0 });
      cell[isCall ? 'call' : 'put'] += q;
    }
  }
  out.total = out.calls + out.puts;
  out.putCallRatio = out.calls > 0 ? out.puts / out.calls : null;
  return out;
}

/** Trades in the last 24h: count, size (BTC), premium (MUSD), and per-strike size for one expiry. */
export function volume24h(trades, options, nowSec, expiry = null) {
  const byId = new Map(options.map(o => [String(o.id), o]));
  const out = { count: 0, qty: 0, premium: 0, byStrike: {} };
  for (const t of trades) {
    if (!(t.time > nowSec - 86400)) continue;
    const o = byId.get(String(t.id));
    if (!o) continue;
    const q = num(o.quantity);
    out.count++; out.qty += q; out.premium += num(o.premium);
    if (expiry != null && Number(o.expiry) === Number(expiry)) {
      const cell = (out.byStrike[Math.round(num(o.strike))] ||= { call: 0, put: 0 });
      cell[Number(o.optionType) === 0 ? 'call' : 'put'] += q;
    }
  }
  return out;
}

/** Price per 1 BTC option shown in the chosen unit: 'musd' (MUSD), 'btc' (BTC, like Deribit) or 'pct' (% of spot). */
export function inUnit(pricePerBtc, spot, unit) {
  if (pricePerBtc == null || !(spot > 0)) return null;
  if (unit === 'btc') return pricePerBtc / spot;
  if (unit === 'pct') return pricePerBtc / spot * 100;
  return pricePerBtc;
}

export function fmtUnit(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  if (unit === 'btc') return v < 0.0001 ? v.toExponential(1) : v.toFixed(4);
  if (unit === 'pct') return `${v < 0.01 ? v.toFixed(3) : v.toFixed(2)}%`;
  return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
