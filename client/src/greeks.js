// Black-Scholes Greeks — delta and theta
// vol: implied volatility (default 0.80 = 80% for BTC)
// r:   risk-free rate (default 0.05)

function cdf(x) {
  // Abramowitz & Stegun approximation
  const a = [0, 0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const poly = k * (a[1] + k * (a[2] + k * (a[3] + k * (a[4] + k * a[5]))));
  const result = 1 - pdf * poly;
  return x >= 0 ? result : 1 - result;
}

function pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function greeks(isCall, spot, strike, timeToExpiryHours, vol = 0.80, r = 0.05) {
  const T = timeToExpiryHours / 8760; // hours → years
  if (T <= 0 || spot <= 0 || strike <= 0) return { delta: null, theta: null };

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  const delta = isCall ? cdf(d1) : cdf(d1) - 1;

  // theta per day
  const thetaAnnual = isCall
    ? (-(spot * pdf(d1) * vol) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * cdf(d2))
    : (-(spot * pdf(d1) * vol) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * cdf(-d2));
  const theta = thetaAnnual / 365;

  const gamma = pdf(d1) / (spot * vol * sqrtT);          // per 1 USD move
  const vega = spot * pdf(d1) * sqrtT / 100;              // per 1 volatility point
  return {
    delta: parseFloat(delta.toFixed(3)), theta: parseFloat(theta.toFixed(2)),
    gamma: parseFloat(gamma.toPrecision(3)), vega: parseFloat(vega.toFixed(2)),
  };
}

/** Black-Scholes price per 1 BTC (same model as the contract; used for mark prices and the payoff preview). */
export function bsPrice(isCall, spot, strike, timeToExpiryHours, vol = 0.80, r = 0.05) {
  const T = timeToExpiryHours / 8760;
  if (spot <= 0 || strike <= 0) return 0;
  if (T <= 0) return Math.max(0, isCall ? spot - strike : strike - spot);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const disc = strike * Math.exp(-r * T);
  return isCall ? spot * cdf(d1) - disc * cdf(d2) : disc * cdf(-d2) - spot * cdf(-d1);
}

/**
 * Volatility that makes the Black-Scholes price equal `price` (per 1 BTC), by bisection.
 * Returns null when the price is outside what any volatility in [1%, 500%] can produce
 * (for example a price below the option's exercise value).
 */
export function impliedVol(isCall, spot, strike, timeToExpiryHours, price, r = 0.05) {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(timeToExpiryHours > 0)) return null;
  let lo = 0.01, hi = 5;
  if (bsPrice(isCall, spot, strike, timeToExpiryHours, lo, r) > price || bsPrice(isCall, spot, strike, timeToExpiryHours, hi, r) < price) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(isCall, spot, strike, timeToExpiryHours, mid, r) > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
