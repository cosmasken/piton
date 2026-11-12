// Portfolio maths for one wallet. Pure functions; contract options have BigInt fields (1e18 scale),
// subgraph values are decimal strings.
import { bsPrice, greeks } from './greeks.js';

const FEE = 0.02; // protocol fee on premium (OptionPool.protocolFeeBps = 200)
const e18 = v => (typeof v === 'bigint' ? Number(v) / 1e18 : Number(v));
const lc = a => (a ? String(a).toLowerCase() : '');

/**
 * Live positions (filled, not expired) with mark value, P&L and greeks scaled by size and side.
 * Long = +, short = - for greeks and value. Returns { rows, totals }.
 */
/** option id -> what this wallet paid for it (subgraph holderCost), for options it bought on resale. */
export function holderCosts(history, me) {
  const m = lc(me), out = {};
  for (const o of history?.ended || []) {
    if (lc(o.long?.id ?? o.long) === m && Number(o.holderCost) > 0) out[String(o.id)] = Number(o.holderCost);
  }
  return out;
}

/** `costs` (optional, from holderCosts): the price this wallet paid when it differs from the premium (resale). */
export function livePositions(options, me, spot, vol, nowSec, costs = {}) {
  const m = lc(me), rows = [];
  const totals = { pnl: 0, value: 0, premiumAtRisk: 0, collateralLocked: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  if (!m || !(spot > 0)) return { rows, totals };
  for (const o of options) {
    if (Number(o.status) !== 1 || Number(o.expiry) <= nowSec) continue;
    const isLong = lc(o.long) === m, isShort = lc(o.short) === m;
    if (!isLong && !isShort) continue;
    const isCall = Number(o.optionType) === 0, strike = e18(o.strike), qty = e18(o.quantity), premium = e18(o.premium);
    const hours = (Number(o.expiry) - nowSec) / 3600;
    const mark = bsPrice(isCall, spot, strike, hours, vol) * qty;
    const g = greeks(isCall, spot, strike, hours, vol);
    const sign = isLong ? 1 : -1;
    const cost = isLong && costs[String(o.id)] > 0 ? costs[String(o.id)] : premium;
    const pnl = isLong ? mark - cost : premium * (1 - FEE) - mark;
    const row = {
      id: o.id, isCall, strike, qty, premium, isLong, expiry: Number(o.expiry), mark, pnl,
      delta: sign * (g.delta || 0) * qty, gamma: sign * (g.gamma || 0) * qty, theta: sign * (g.theta || 0) * qty, vega: sign * (g.vega || 0) * qty,
      itm: isCall ? spot > strike : spot < strike, intrinsic: Math.max(0, isCall ? spot - strike : strike - spot) * qty,
    };
    rows.push(row);
    totals.pnl += pnl; totals.value += sign * mark;
    totals.delta += row.delta; totals.gamma += row.gamma; totals.theta += row.theta; totals.vega += row.vega;
    if (isLong) totals.premiumAtRisk += cost; else totals.collateralLocked += e18(o.collateral);
  }
  return { rows, totals };
}

/**
 * Realised P&L of options that have ended, from the subgraph's Option entities.
 * Long: payout - premium. Short (peer-to-peer seller): premium after fee - payout. Cancelled orders: 0.
 */
export function realisedPnl(subOptions, me, resales = []) {
  const m = lc(me);
  let total = 0;
  const rows = [];
  for (const o of subOptions) {
    if (!['SETTLED', 'REFUNDED', 'CLOSED'].includes(o.status)) continue;
    const isLong = lc(o.long?.id ?? o.long) === m, isShort = lc(o.short) === m;
    if (!isLong && !isShort) continue;
    const premium = Number(o.premium), payout = Number(o.payout);
    // a holder who bought it on resale paid the resale price, not the original premium
    const cost = Number(o.holderCost) > 0 ? Number(o.holderCost) : premium;
    const pnl = isLong ? payout - cost : premium * (1 - FEE) - payout;
    total += pnl;
    rows.push({ id: o.id, pnl, isLong });
  }
  // options this wallet sold on to another trader: the price (less the fee) minus what it had paid
  for (const r of resales) {
    if (lc(r.seller?.id ?? r.seller) !== m) continue;
    const pnl = Number(r.price) * (1 - FEE) - Number(r.sellerCost);
    total += pnl;
    rows.push({ id: r.option?.id ?? r.option, pnl, isLong: true, resale: true });
  }
  return { total, rows };
}

/** LP result: what the shares are worth now plus what was withdrawn, minus what was deposited. */
export function lpPosition({ deposited = 0, withdrawn = 0 } = {}, shares, shareValue, totalShares) {
  const value = shares * shareValue;
  return {
    shares, value, deposited: Number(deposited), withdrawn: Number(withdrawn),
    pnl: value + Number(withdrawn) - Number(deposited),
    sharePct: totalShares > 0 ? shares / totalShares * 100 : 0,
  };
}

/** The pool's exposure: collateral and size of live pool-sold options by expiry and by strike. */
export function poolExposure(options, poolAddress, nowSec) {
  const pa = lc(poolAddress), byExpiry = {}, byStrike = {};
  let collateral = 0;
  for (const o of options) {
    if (Number(o.status) !== 1 || Number(o.expiry) <= nowSec || !(o.filledByPool || lc(o.short) === pa)) continue;
    const c = e18(o.collateral), q = e18(o.quantity), k = Math.round(e18(o.strike)), side = Number(o.optionType) === 0 ? 'call' : 'put';
    collateral += c;
    const ex = (byExpiry[Number(o.expiry)] ||= { collateral: 0, qty: 0, count: 0 });
    ex.collateral += c; ex.qty += q; ex.count++;
    const st = (byStrike[k] ||= { call: 0, put: 0, collateral: 0 });
    st[side] += q; st.collateral += c;
  }
  return { collateral, byExpiry, byStrike };
}

/**
 * Options that need attention: held long, in the money, auto-exercise off, expiring within `withinSec`.
 * autoEx: map of option id (string) -> boolean.
 */
export function expiryAlerts(rows, autoEx, nowSec, withinSec = 3600) {
  return rows.filter(r => r.isLong && r.itm && !autoEx[String(r.id)] && r.expiry - nowSec <= withinSec && r.expiry > nowSec);
}

/** RFC 4180 CSV: quotes fields containing commas, quotes or newlines. */
export function toCsv(header, rows) {
  const q = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map(r => r.map(q).join(',')).join('\n') + '\n';
}
