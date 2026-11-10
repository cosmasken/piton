// Instruments (an option = type + strike + expiry), expiry slots and order-book grouping.
// Pure functions, no network. The contract lets any expiry be chosen, so the UI offers standard
// expiry slots (like an exchange) so that orders for the same instrument land in the same book.

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const HOUR = 3600, DAY = 86400;
export const MIN_SLOT_LEAD = 65 * 60;       // slots must be a bit more than an hour away (pool needs > 15 min, default 1 h)
export const MAX_EXPIRY_SECS = 14 * DAY;    // contract MAX_EXPIRY

/** Standard expiry slots after `nowSec`: next two top-of-hour times, daily 08:00 UTC for a week, Friday 08:00 UTC to 14 days. */
export function expirySlots(nowSec) {
  const out = new Set();
  const earliest = nowSec + MIN_SLOT_LEAD;
  const latest = nowSec + MAX_EXPIRY_SECS - HOUR;
  let h = Math.ceil(earliest / HOUR) * HOUR;
  for (let i = 0; i < 2; i++, h += HOUR) out.add(h);                 // intraday
  const day0 = Math.floor(nowSec / DAY) * DAY;
  for (let d = 0; d <= 15; d++) {
    const t = day0 + d * DAY + 8 * HOUR;                             // 08:00 UTC
    if (t < earliest || t > latest) continue;
    const weekday = new Date(t * 1000).getUTCDay();                  // 5 = Friday
    if (d <= 7 || weekday === 5) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

const pad = n => String(n).padStart(2, '0');

/** "28 NOV 08:00" */
export function expiryLabel(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Instrument name in exchange style: BTC-28NOV-75000-P (time added when it is not 08:00 UTC). */
export function instrumentName({ isCall, strike, expiry }) {
  const d = new Date(Number(expiry) * 1000);
  const date = `${pad(d.getUTCDate())}${MONTHS[d.getUTCMonth()]}`;
  const time = d.getUTCHours() === 8 && d.getUTCMinutes() === 0 ? '' : `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `BTC-${date}${time}-${Math.round(Number(strike))}-${isCall ? 'C' : 'P'}`;
}

/** Compact id used in URLs: C-75000-1764316800 */
export function instrumentId({ isCall, strike, expiry }) {
  return `${isCall ? 'C' : 'P'}-${Math.round(Number(strike))}-${Math.floor(Number(expiry))}`;
}

export function parseInstrumentId(id) {
  const m = /^([CP])-(\d{1,9})-(\d{9,11})$/.exec(String(id || ''));
  if (!m) return null;
  return { isCall: m[1] === 'C', strike: Number(m[2]), expiry: Number(m[3]) };
}

const NICE_STEPS = [100, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Strike rows around spot (default +-20%), on a round step, plus any extra strikes that already have orders. */
export function strikeLadder(spot, extra = [], bandPct = 20) {
  if (!(spot > 0)) return [...new Set(extra)].sort((a, b) => a - b);
  const step = NICE_STEPS.find(s => s >= spot * 0.02) || NICE_STEPS[NICE_STEPS.length - 1];
  const lo = Math.ceil(spot * (1 - bandPct / 100) / step) * step;
  const hi = Math.floor(spot * (1 + bandPct / 100) / step) * step;
  const out = new Set(extra.map(Number));
  for (let k = lo; k <= hi; k += step) out.add(k);
  return [...out].filter(k => k > 0).sort((a, b) => a - b);
}

/** The strike closest to spot (the at-the-money row). */
export function atmStrike(strikes, spot) {
  return strikes.reduce((best, k) => (best == null || Math.abs(k - spot) < Math.abs(best - spot) ? k : best), null);
}

const E18 = 1e18;
const num = v => (typeof v === 'bigint' ? Number(v) / E18 : Number(v));

/**
 * Open peer-to-peer orders for one instrument. `options` are contract options (BigInt fields).
 * ask = a seller waiting (short order); bid = a buyer waiting (long order the pool did not fill).
 * Prices are premium per 1 BTC. Asks sorted cheapest first, bids highest first.
 */
export function bookFor(options, { isCall, strike, expiry }, zero = '0x0000000000000000000000000000000000000000') {
  const asks = [], bids = [];
  for (const o of options) {
    if (Number(o.status) !== 0) continue;                                  // OPEN only
    if ((Number(o.optionType) === 0) !== isCall) continue;
    if (Math.round(num(o.strike)) !== Math.round(strike) || Number(o.expiry) !== Number(expiry)) continue;
    const qty = num(o.quantity);
    if (!(qty > 0)) continue;
    const row = { id: o.id, price: num(o.premium) / qty, qty, total: num(o.premium), premiumWei: o.premium, owner: null };
    if (o.long === zero && o.short !== zero) asks.push({ ...row, owner: o.short });
    else if (o.short === zero && o.long !== zero) bids.push({ ...row, owner: o.long });
  }
  asks.sort((a, b) => a.price - b.price);
  bids.sort((a, b) => b.price - a.price);
  return { asks, bids, bestAsk: asks[0] || null, bestBid: bids[0] || null };
}

/** Best bid/ask per (strike, side) for one expiry; used for the option chain rows. */
export function bestQuotes(options, expiry, zero = '0x0000000000000000000000000000000000000000') {
  const map = {};
  for (const o of options) {
    if (Number(o.status) !== 0 || Number(o.expiry) !== Number(expiry)) continue;
    const qty = num(o.quantity);
    if (!(qty > 0)) continue;
    const k = Math.round(num(o.strike));
    const side = Number(o.optionType) === 0 ? 'call' : 'put';
    const cell = ((map[k] ||= {})[side] ||= { bid: null, ask: null });
    const price = num(o.premium) / qty;
    if (o.long === zero && o.short !== zero) cell.ask = cell.ask == null ? price : Math.min(cell.ask, price);
    else if (o.short === zero && o.long !== zero) cell.bid = cell.bid == null ? price : Math.max(cell.bid, price);
  }
  return map;
}

/** Expiries that have live orders or positions but are not standard slots (so they stay reachable). */
export function extraExpiries(options, slots, nowSec) {
  const known = new Set(slots);
  const out = new Set();
  for (const o of options) {
    const st = Number(o.status);
    if ((st === 0 || st === 1) && Number(o.expiry) > nowSec && !known.has(Number(o.expiry))) out.add(Number(o.expiry));
  }
  return [...out].sort((a, b) => a - b);
}
