// Pure helpers for the IV keeper (no network / chain access, so they can be unit-tested).

const MIN_IV_PCT = 25;   // must match OptionPool.MIN_IV (25e16)
const MAX_IV_PCT = 150;  // must match OptionPool.MAX_IV (15e17)

/** Parse Deribit get_volatility_index_data JSON; returns the latest close (DVOL, in %) or null. */
function latestDvol(json) {
  const rows = json && json.result && json.result.data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const last = rows[rows.length - 1]; // [timestamp, open, high, low, close]
  const close = Number(last[4]);
  return Number.isFinite(close) && close > 0 ? { pct: close, ts: Number(last[0]) } : null;
}

/** Clamp a DVOL % into the contract's allowed IV range. */
function clampIvPct(pct) {
  return Math.min(MAX_IV_PCT, Math.max(MIN_IV_PCT, pct));
}

/**
 * Decide whether to push a new IV on-chain.
 * @param dvolPct      latest DVOL in percent (e.g. 39.5)
 * @param currentWei   current on-chain iv (BigInt, 1e18 = 100%)
 * @param minChangePct only update if |target - current| >= this many vol points (avoid gas churn)
 * @returns { update, targetWei, targetPct, currentPct }
 */
function planUpdate(dvolPct, currentWei, minChangePct = 2) {
  const targetPct = Math.round(clampIvPct(dvolPct) * 100) / 100; // 2 dp
  const targetWei = BigInt(Math.round(targetPct * 100)) * 10n ** 14n; // pct*1e16, via 2dp integer
  const currentPct = Number(currentWei) / 1e16;
  return { update: Math.abs(targetPct - currentPct) >= minChangePct, targetWei, targetPct, currentPct };
}

/** True if the data point is too old to trust (Deribit publishes hourly candles here). */
function isStale(tsMs, nowMs, maxAgeMs = 3 * 3600 * 1000) {
  return nowMs - tsMs > maxAgeMs;
}

module.exports = { MIN_IV_PCT, MAX_IV_PCT, latestDvol, clampIvPct, planUpdate, isStale };
