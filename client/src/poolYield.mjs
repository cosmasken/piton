// Pool yield for depositors: annualised share-price growth from the subgraph's hourly snapshots, and where the
// yield came from (option premiums kept after payouts, Mezo savings, less the performance fee).

const DAY = 86400;

/**
 * Share-price growth over the last `days`, as a simple annual rate (0.12 = 12% a year).
 * `snaps` are hourly snapshots { periodStart, sharePrice } in ascending time order; each holds the share price after
 * the last event in its hour, which stays valid until the next event. Returns null until the pool has `days` of
 * history, so a few hours of data never show as a huge annual number.
 */
export function annualisedReturn(snaps, { nowSec, sharePrice, days }) {
  if (!(sharePrice > 0) || !Array.isArray(snaps) || !snaps.length || !(days > 0)) return null;
  const from = nowSec - days * DAY;
  if (Number(snaps[0].periodStart) > from) return null;          // not enough history yet
  let base = null;
  for (const s of snaps) { if (Number(s.periodStart) <= from) base = s; else break; }
  const p0 = Number(base.sharePrice);
  const span = (nowSec - Number(base.periodStart)) / DAY;
  if (!(p0 > 0) || !(span > 0)) return null;
  return (sharePrice / p0 - 1) * 365 / span;
}

/** Days of share-price history available (from the first snapshot to now). */
export function historyDays(snaps, nowSec) {
  if (!Array.isArray(snaps) || !snaps.length) return 0;
  return Math.max(0, (nowSec - Number(snaps[0].periodStart)) / DAY);
}

/**
 * Where depositors' yield came from, from the pool's on-chain running totals (MUSD).
 * options: premiums the pool has earned (premium on still-open options excluded) minus payouts to buyers;
 * savings: Mezo savings rate on spare MUSD; fees: performance fee paid to the protocol. net = options + savings - fees.
 */
export function yieldBreakdown(p) {
  if (!p) return null;
  const n = v => (Number.isFinite(v) ? v : 0);
  const options = n(p.premiumsEarned) - n(p.unearnedPremium) - n(p.settlementsPaid);
  const savings = n(p.savingsYield);
  const fees = n(p.performanceFeesPaid);
  return { options, savings, fees, net: options + savings - fees };
}
