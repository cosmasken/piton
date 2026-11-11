// Order-form maths and the "fills now / rests" decision. Pure functions; amounts are numbers in MUSD/BTC.

/** Round a size down to 4 decimals (0.0001 BTC), so a quick-fill never overshoots the budget. */
export const floorSize = v => (v > 0 ? Math.floor(v * 1e4 + 1e-9) / 1e4 : 0);

/** BTC size for a notional amount in MUSD (size x spot). */
export function sizeFromNotional(notional, spot) {
  return notional > 0 && spot > 0 ? notional / spot : 0;
}

/**
 * Size that spends about `fraction` of the wallet: a buyer pays the premium, a seller locks collateral.
 * pricePerBtc: premium per 1 BTC (buy); collateralPerBtc: collateral per 1 BTC (sell).
 * A 1% margin is kept on buys because the pool price per BTC rises slightly with size.
 */
export function sizeForBudget({ side, balance, fraction, pricePerBtc, collateralPerBtc }) {
  const budget = balance * fraction;
  if (!(budget > 0)) return 0;
  if (side === 'buy') return pricePerBtc > 0 ? floorSize(budget / (pricePerBtc * 1.01)) : 0;
  return collateralPerBtc > 0 ? floorSize(budget / collateralPerBtc) : 0;
}

export const priceFromPct = (pct, spot) => (pct > 0 && spot > 0 ? pct / 100 * spot : 0);
export const pctFromPrice = (price, spot) => (price > 0 && spot > 0 ? price / spot * 100 : 0);

/**
 * What happens when the order is sent. The contract only matches a new buy against the pool; resting
 * user orders are taken by clicking them in the book, so that is offered as a hint.
 * Returns { kind: 'fills' | 'rests', text, hint? }.
 */
export function outcome({ side, reasons = [], quote, premium, pricePerBtc, bestAsk, bestBid }) {
  if (side === 'buy') {
    if (reasons.length) {
      return { kind: 'rests', poolRefuses: true, text: `Rests on the book as a bid. The pool won't sell this: ${reasons.join('; ')}.`,
        hint: bestAsk ? `A trader is selling at ${bestAsk.price.toFixed(2)} per BTC; click it in the book to buy now.` : null };
    }
    if (quote == null) return { kind: 'rests', text: 'Waiting for the pool price…' };
    if (premium >= quote) return { kind: 'fills', text: `Fills now: the pool sells at ${(quote).toFixed(2)} MUSD for this size.` };
    if (premium >= quote * 0.95) {
      return { kind: 'rests', text: 'Close to the pool price: it may fill now, or rest as a bid. Pay the pool price to be sure.' };
    }
    return { kind: 'rests', text: `Rests on the book as a bid: your price is below the pool's (${(quote).toFixed(2)} MUSD).`,
      hint: bestAsk && bestAsk.price <= pricePerBtc ? `A trader is selling at ${bestAsk.price.toFixed(2)} per BTC; click it in the book to buy now.` : null };
  }
  if (bestBid && bestBid.price >= pricePerBtc) {
    return { kind: 'rests', text: 'Rests on the book as an ask until a buyer takes it.',
      hint: `A buyer is bidding ${bestBid.price.toFixed(2)} per BTC, at or above your price: click it in the book to sell now.` };
  }
  return { kind: 'rests', text: 'Rests on the book as an ask until a buyer takes it. You can cancel it any time.' };
}

/** Facts about one instrument from the loaded options and fills: last trade, 24h size, open interest. */
export function instrumentStats(options, trades, inst, nowSec) {
  const same = o => (Number(o.optionType) === 0) === inst.isCall && Number(o.expiry) === Number(inst.expiry)
    && Math.round(Number(o.strike) / 1e18) === Math.round(inst.strike);
  const byId = new Map(options.map(o => [String(o.id), o]));
  let last = null, vol24 = 0, oi = 0;
  for (const t of trades) {                                   // trades are newest first
    const o = byId.get(String(t.id));
    if (!o || !same(o)) continue;
    const q = Number(o.quantity) / 1e18;
    if (!last) last = { price: Number(o.premium) / 1e18 / q, qty: q, time: t.time, byPool: t.byPool };
    if (t.time > nowSec - 86400) vol24 += q;
  }
  for (const o of options) if (same(o) && Number(o.status) === 1 && Number(o.expiry) > nowSec) oi += Number(o.quantity) / 1e18;
  return { last, vol24, oi };
}

/**
 * Minimum payout to accept when selling back to the pool. The bid moves every block with BTC: on a short, cheap
 * option a few dollars of BTC can move it 5-10%, so a plain percentage is too tight. Allow the larger of the
 * user's slippage (% of the bid) and `moveRisk` (how much the bid falls if BTC moves against the option by a
 * small amount while the transaction is mined; computed by the caller from the pricing model).
 */
export function sellBackMin(bid, slippagePct, moveRisk = 0) {
  if (!(bid > 0)) return 0;
  const slack = Math.max(bid * (slippagePct > 0 ? slippagePct : 2) / 100, moveRisk > 0 ? moveRisk : 0);
  return Math.max(0, bid - slack);
}
