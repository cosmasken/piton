// Data shaping for the price chart. Pure functions, no network.

/** Chart intervals: label, Binance kline interval, seconds per candle, candles to load. */
export const INTERVALS = [
  { key: '5m', binance: '5m', secs: 300, limit: 500 },
  { key: '15m', binance: '15m', secs: 900, limit: 500 },
  { key: '1h', binance: '1h', secs: 3600, limit: 500 },
  { key: '4h', binance: '4h', secs: 14400, limit: 500 },
  { key: '1D', binance: '1d', secs: 86400, limit: 365 },
  { key: '1W', binance: '1w', secs: 604800, limit: 200 },
];

/** Binance REST klines -> chart candles (time in unix seconds, UTC). Skips malformed rows. */
export function parseKlines(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const k of raw) {
    const c = { time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
    if ([c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) out.push(c);
  }
  return out.sort((a, b) => a.time - b.time);
}

/** One Binance websocket kline message -> candle, or null. */
export function parseKlineMessage(msg) {
  const k = msg && msg.k;
  if (!k) return null;
  const c = { time: Math.floor(Number(k.t) / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
  return [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) ? c : null;
}

/**
 * Expected-move cone from now to expiry: spot x exp(+-k x vol x sqrt(t)), t in years (lognormal, k = 1
 * covers about 68% of outcomes). Points land on the candle grid (`step` seconds) so they line up with
 * the time axis, plus a final point exactly at expiry.
 */
export function expectedMoveCone(spot, vol, fromSec, toSec, step, k = 1) {
  if (!(spot > 0) || !(vol > 0) || !(toSec > fromSec) || !(step > 0)) return { upper: [], lower: [] };
  const upper = [], lower = [];
  const push = t => {
    const years = Math.max(0, t - fromSec) / (365 * 86400);
    const m = Math.exp(k * vol * Math.sqrt(years));
    upper.push({ time: t, value: spot * m });
    lower.push({ time: t, value: spot / m });
  };
  const first = Math.floor(fromSec / step) * step;
  const maxPoints = 400;
  const stride = Math.max(step, Math.ceil((toSec - first) / maxPoints / step) * step);
  for (let t = first; t < toSec; t += stride) push(t);
  push(toSec);
  return { upper, lower };
}

/** Trove liquidation price: debt x MCR / collateral (MUSD per BTC), or null without a Trove. */
export function liquidationPrice(coll, debt, mcr = 1.1) {
  return coll > 0 && debt > 0 ? debt * mcr / coll : null;
}

const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "11 Nov 14:05" in UTC or local time. */
export function fmtTime(sec, utc) {
  const d = new Date(sec * 1000);
  const [day, mon, h, m] = utc
    ? [d.getUTCDate(), d.getUTCMonth(), d.getUTCHours(), d.getUTCMinutes()]
    : [d.getDate(), d.getMonth(), d.getHours(), d.getMinutes()];
  return `${day} ${MON[mon]} ${pad(h)}:${pad(m)}`;
}

/** Axis label: time of day for intraday ticks, day + month for day ticks, month + year beyond. */
export function fmtTick(sec, utc, kind) {
  const d = new Date(sec * 1000);
  const g = utc
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
    : { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  if (kind === 'year') return String(g.y);
  if (kind === 'month') return `${MON[g.mo]} ${g.y}`;
  if (kind === 'day') return `${g.day} ${MON[g.mo]}`;
  return `${pad(g.h)}:${pad(g.mi)}`;
}
