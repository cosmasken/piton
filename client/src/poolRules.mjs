// Pure helpers that mirror the pool's rules, so the UI can explain them before a transaction.
// Everything here is display logic only: the contract enforces the real limits.

export const BPS = 10000;

/** "1h 05m", "4m 12s", "30s" for a number of seconds (rounded up to the second shown). */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/** Seconds left on a deposit lock (0 when unlocked). */
export function lockRemaining(lockExpiry, nowSec) {
  return Math.max(0, Number(lockExpiry || 0) - nowSec);
}

/** True while the circuit breaker is pausing pool sales and deposits. */
export function breakerActive(cbUntil, nowSec) {
  return Number(cbUntil || 0) > nowSec;
}

/**
 * Why the pool would NOT sell this option itself (order would rest as an open bid instead).
 * Empty array = the pool should fill it (the exact price check still happens on-chain).
 * p: { strikeDistanceBps, minPoolExpiry, cbUntil, utilisationBps, maxUtilisationBps,
 *      totalAssets, lockedCollateral, maxOptionExposureBps, maxOptionCollateral }  (MUSD amounts as numbers)
 * collateral (optional): MUSD the pool would lock for this order. When given, the size limits are
 * checked exactly as the contract does (against pool assets before the premium is added).
 */
export function poolWontFill({ spot, strike, expirySecs, nowSec, collateral, seriesCollateral = 0, newSeries = false }, p) {
  const reasons = [];
  if (!(spot > 0) || !(strike > 0)) return reasons;
  const dist = Math.abs(strike - spot) / spot * BPS;
  if (p.strikeDistanceBps != null && dist > p.strikeDistanceBps) {
    reasons.push(`strike is ${(dist / 100).toFixed(0)}% from the current price; the pool only sells within ${p.strikeDistanceBps / 100}%`);
  }
  if (p.minPoolExpiry != null && expirySecs < p.minPoolExpiry) {
    reasons.push(`the pool only sells options with at least ${fmtDuration(p.minPoolExpiry)} left`);
  }
  if (breakerActive(p.cbUntil, nowSec)) {
    reasons.push('the circuit breaker is active after a fast price move');
  }
  const sized = collateral > 0 && p.totalAssets > 0;
  if (sized) {
    const fmt = v => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p.maxOptionCollateral != null && collateral > p.maxOptionCollateral) {
      reasons.push(`this option needs ${fmt(collateral)} MUSD of collateral; the pool locks at most ${fmt(p.maxOptionCollateral)} MUSD per option`);
    } else if (p.maxOptionExposureBps != null && (seriesCollateral + collateral) * BPS > p.totalAssets * p.maxOptionExposureBps) {
      const cap = p.totalAssets * p.maxOptionExposureBps / BPS;
      reasons.push(seriesCollateral > 0
        ? `the pool already locks ${fmt(seriesCollateral)} MUSD in this option and may lock at most ${fmt(cap)} MUSD (${p.maxOptionExposureBps / 100}% of the pool) in one strike and expiry. Try a smaller size`
        : `this option needs ${fmt(collateral)} MUSD of collateral; one strike and expiry may use at most ${p.maxOptionExposureBps / 100}% of the pool (${fmt(cap)} MUSD). Try a smaller size`);
    }
    if (p.maxUtilisationBps != null && p.lockedCollateral != null
        && (p.lockedCollateral + collateral) * BPS > p.totalAssets * p.maxUtilisationBps) {
      reasons.push(`it would take the pool past its ${p.maxUtilisationBps / 100}% utilisation limit`);
    }
  } else if (p.maxUtilisationBps != null && p.utilisationBps != null && p.utilisationBps >= p.maxUtilisationBps) {
    reasons.push(`the pool is at its ${p.maxUtilisationBps / 100}% utilisation limit`);
  }
  if (newSeries && p.maxOpenSeries != null && p.openSeriesCount != null && p.openSeriesCount >= p.maxOpenSeries) {
    reasons.push(`the pool is at its limit of ${p.maxOpenSeries} open strike/expiry combinations; pick one it already sells, or wait for some to expire`);
  }
  return reasons;
}

/** What a withdrawal pays: shares x share value, minus the exit fee while pool options are open. */
export function withdrawEstimate(shares, shareValue, feeBps, openOptions) {
  const gross = shares * shareValue;
  const fee = openOptions > 0 ? gross * feeBps / BPS : 0;
  return { gross, fee, net: gross - fee };
}

/**
 * Largest size (BTC, rounded down to 0.0001) the pool can sell of one option right now, from its collateral
 * limits: per-option cap, share of the pool per series (minus `seriesCollateral` already locked in it), and the
 * utilisation limit. `collateralPerBtc` is the
 * collateral the pool locks per 1 BTC of this option. Null when the pool state is not known yet.
 */
export function poolMaxSize(collateralPerBtc, p, seriesCollateral = 0) {
  if (!(collateralPerBtc > 0) || !(p?.totalAssets > 0)) return null;
  const caps = [];
  if (p.maxOptionCollateral != null) caps.push(p.maxOptionCollateral);
  // the share-of-pool limit covers the whole series (same type, strike and expiry), including what the pool holds
  if (p.maxOptionExposureBps != null) caps.push(p.totalAssets * p.maxOptionExposureBps / BPS - seriesCollateral);
  if (p.maxUtilisationBps != null && p.lockedCollateral != null) caps.push(p.totalAssets * p.maxUtilisationBps / BPS - p.lockedCollateral);
  if (!caps.length) return null;
  // 0.1% headroom: call collateral is recomputed from the price when the order is mined
  return Math.max(0, Math.floor(Math.min(...caps) * 0.999 / collateralPerBtc * 1e4) / 1e4);
}
