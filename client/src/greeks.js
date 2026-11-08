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

  return { delta: parseFloat(delta.toFixed(3)), theta: parseFloat(theta.toFixed(2)) };
}
