import test from 'node:test';
import assert from 'node:assert/strict';
import { floorSize, sizeFromNotional, sizeForBudget, priceFromPct, pctFromPrice, outcome, instrumentStats } from './orderForm.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('sizes: floor to 0.0001, notional, budget for buyer and seller', () => {
  assert.equal(floorSize(0.012399), 0.0123);
  assert.equal(floorSize(0.0123), 0.0123);
  assert.equal(floorSize(-1), 0);
  close(sizeFromNotional(740, 74000), 0.01);
  // buyer with 100 MUSD at 880 per BTC: 50% = 50 MUSD -> 0.0562 BTC (1% margin for size markup)
  assert.equal(sizeForBudget({ side: 'buy', balance: 100, fraction: 0.5, pricePerBtc: 880 }), 0.0562);
  // seller locking 74,000 per BTC with 358 MUSD: 100% -> 0.0048 BTC
  assert.equal(sizeForBudget({ side: 'sell', balance: 358, fraction: 1, collateralPerBtc: 74000 }), 0.0048);
  assert.equal(sizeForBudget({ side: 'buy', balance: 0, fraction: 1, pricePerBtc: 880 }), 0);
  assert.equal(sizeForBudget({ side: 'buy', balance: 100, fraction: 1, pricePerBtc: 0 }), 0);
});

test('price as % of spot round-trips', () => {
  close(priceFromPct(1.2, 74000), 888);
  close(pctFromPrice(888, 74000), 1.2);
  assert.equal(priceFromPct(0, 74000), 0);
});

test('outcome: buy fills only at or above the pool price and only when the pool will sell', () => {
  assert.equal(outcome({ side: 'buy', reasons: [], quote: 8.8, premium: 8.8 }).kind, 'fills');
  assert.equal(outcome({ side: 'buy', reasons: [], quote: 8.8, premium: 8.5 }).kind, 'rests');     // within 5%: uncertain
  assert.match(outcome({ side: 'buy', reasons: [], quote: 8.8, premium: 8.5 }).text, /may fill/);
  assert.match(outcome({ side: 'buy', reasons: [], quote: 8.8, premium: 5 }).text, /below the pool's/);
  const r = outcome({ side: 'buy', reasons: ['one option may use at most 25% of the pool'], quote: 8.8, premium: 9, bestAsk: { price: 900 } });
  assert.equal(r.kind, 'rests'); assert.match(r.text, /25%/); assert.match(r.hint, /900\.00/);
  assert.equal(outcome({ side: 'buy', reasons: [], quote: null, premium: 9 }).kind, 'rests');
});

test('outcome: sell always rests; a bid at or above your price is offered as a hint', () => {
  assert.equal(outcome({ side: 'sell', pricePerBtc: 600 }).kind, 'rests');
  assert.equal(outcome({ side: 'sell', pricePerBtc: 600, bestBid: { price: 550 } }).hint, undefined);
  assert.match(outcome({ side: 'sell', pricePerBtc: 600, bestBid: { price: 650 } }).hint, /650\.00/);
});

const E = v => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
const opt = (id, type, strike, expiry, qty, prem, status = 1n) =>
  ({ id: BigInt(id), optionType: BigInt(type), status, strike: E(strike), expiry: BigInt(expiry), quantity: E(qty), premium: E(prem) });

test('instrument stats: last trade, 24h size and open interest for one option only', () => {
  const now = 100000, inst = { isCall: false, strike: 74000, expiry: 200000 };
  const options = [opt(1, 1, 74000, 200000, 0.01, 8.8), opt(2, 1, 74000, 200000, 0.02, 18), opt(3, 0, 74000, 200000, 1, 1), opt(4, 1, 74000, 200000, 0.5, 1, 2n)];
  const trades = [{ id: 2n, time: now - 100, byPool: true }, { id: 3n, time: now - 50 }, { id: 1n, time: now - 90000 }, { id: 4n, time: now - 10 }];
  const s = instrumentStats(options, trades, inst, now);
  close(s.last.price, 900); close(s.last.qty, 0.02);   // id 4 is newest in time but listed after: trades list order is used (newest first)
  close(s.vol24, 0.02 + 0.5);                          // id 1 is older than 24h; id 3 is a call
  close(s.oi, 0.03);                                   // id 4 is settled
});
