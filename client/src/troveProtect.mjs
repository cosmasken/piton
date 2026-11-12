// Pure helpers for "Protect my Trove": size a BTC put that pays out as the user's Mezo Trove
// approaches liquidation. No chain access here so it can be unit-tested with `node --test`.

export const MCR = 1.1;            // Mezo minimum collateral ratio (liquidation below this)
export const DEFAULT_BUFFER = 0.15; // strike this far above the liquidation price

/** BTC price at which the Trove hits MCR. */
export function liquidationPrice(collBtc, debtMusd, mcr = MCR) {
  if (!(collBtc > 0) || !(debtMusd > 0)) return 0;
  return (debtMusd * mcr) / collBtc;
}

/** Current collateral ratio (e.g. 2.0 = 200%). */
export function collateralRatio(collBtc, debtMusd, spot) {
  if (!(debtMusd > 0)) return Infinity;
  return (collBtc * spot) / debtMusd;
}

/**
 * Suggest a protective put.
 * @param coll        Trove collateral in BTC
 * @param debt        Trove debt in MUSD
 * @param spot        current BTC/USD
 * @param buffer      strike = liquidation price * (1 + buffer)
 * @param coverage    fraction of Trove BTC to insure (0..1)
 * @param maxCollateral  pool's per-option collateral cap in MUSD (put collateral = strike * qty)
 * @param strikeBandBps  optional: the pool sells strikes within this distance of spot; lower strikes move up to it
 * @param maxQty         optional: most BTC the pool can sell of one option now (poolMaxSize); larger sizes are capped
 */
export function suggestProtection({ coll, debt, spot, buffer = DEFAULT_BUFFER, coverage = 1, maxCollateral = Infinity, strikeBandBps, maxQty }) {
  const liqPrice = liquidationPrice(coll, debt);
  if (!liqPrice || !(spot > 0)) return null;

  let strike = Math.round(liqPrice * (1 + buffer));
  // The pool only sells strikes within its band of spot. A loan far from liquidation gets the nearest
  // strike the pool does sell (cheap, and it still pays well before liquidation).
  let farFromLiq = false;
  if (strikeBandBps != null) {
    const minStrike = Math.ceil(spot * (1 - strikeBandBps / 10000) / 1000) * 1000; // round up to a $1,000 strike
    if (strike < minStrike) { strike = minStrike; farFromLiq = true; }
  }
  let qty = coll * Math.min(Math.max(coverage, 0), 1);
  let capped = false;
  if (strike * qty > maxCollateral) { qty = maxCollateral / strike; capped = true; }
  // the most the pool can sell of one option right now (its 25% / utilisation limits), when known
  if (maxQty != null && qty > maxQty) { qty = maxQty; capped = true; }
  qty = Math.floor(qty * 1e6) / 1e6; // 6 dp

  const payoutAtLiq = Math.max(0, strike - liqPrice) * qty; // put payout when price == liquidation price
  return {
    liqPrice,
    strike,
    qty,
    capped,
    farFromLiq,          // strike moved up into the pool's band (the loan is far from liquidation)
    icr: collateralRatio(coll, debt, spot),
    // strike already below spot means the put is OTM today (the normal, cheaper case)
    otm: strike < spot,
    payoutAtLiq,
    payoutPctOfDebt: debt > 0 ? payoutAtLiq / debt : 0,
    maxLoss: strike * qty, // not the buyer's loss; the pool's max payout (= pool collateral)
  };
}
