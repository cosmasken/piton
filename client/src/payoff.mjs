// Profit and loss of one option position at expiry. Mirrors the contract: the long is paid the
// intrinsic value capped at the collateral the seller locked; the seller keeps the premium less the
// protocol fee. Display logic only.

export const CALL_CAP_MULTIPLE = 3;   // OptionPool.CALL_CAP_MULTIPLE
export const PROTOCOL_FEE_BPS = 200;  // OptionPool.protocolFeeBps (default)

/** MUSD the seller locks: puts = strike x qty; calls = (3 x spot - strike) x qty (never negative). */
export function collateralFor(isCall, spot, strike, qty) {
  return isCall ? Math.max(0, CALL_CAP_MULTIPLE * spot - strike) * qty : strike * qty;
}

const intrinsic = (isCall, strike, S) => Math.max(0, isCall ? S - strike : strike - S);

/**
 * leg: { side: 'buy'|'sell', isCall, strike, qty, premium (total MUSD), collateral, feeBps }
 * Returns profit/loss in MUSD at expiry price S.
 */
export function legPnl(leg, S) {
  const paid = Math.min(intrinsic(leg.isCall, leg.strike, S) * leg.qty, leg.collateral);
  if (leg.side === 'buy') return paid - leg.premium;
  const net = leg.premium * (1 - (leg.feeBps ?? PROTOCOL_FEE_BPS) / 10000);
  return net - paid;
}

export function maxGain(leg) {
  const net = leg.premium * (1 - (leg.feeBps ?? PROTOCOL_FEE_BPS) / 10000);
  return leg.side === 'buy' ? leg.collateral - leg.premium : net;
}

export function maxLoss(leg) {
  const net = leg.premium * (1 - (leg.feeBps ?? PROTOCOL_FEE_BPS) / 10000);
  return leg.side === 'buy' ? leg.premium : leg.collateral - net;
}

/** Expiry price at which the position breaks even, or null if it cannot (e.g. a put whose premium exceeds the strike). */
export function breakEven(leg) {
  if (!(leg.qty > 0)) return null;
  const net = leg.premium * (1 - (leg.feeBps ?? PROTOCOL_FEE_BPS) / 10000);
  const perBtc = (leg.side === 'buy' ? leg.premium : net) / leg.qty;
  const be = leg.isCall ? leg.strike + perBtc : leg.strike - perBtc;
  return be > 0 ? be : null;
}

/** Points for a payoff chart: expiry price vs profit and loss, centred on spot. */
export function payoffCurve(leg, spot, points = 41, rangePct = 40) {
  const lo = spot * (1 - rangePct / 100), hi = spot * (1 + rangePct / 100);
  const out = [];
  for (let i = 0; i < points; i++) {
    const S = lo + (hi - lo) * i / (points - 1);
    out.push({ S: Math.round(S), pnl: legPnl(leg, S) });
  }
  return out;
}
