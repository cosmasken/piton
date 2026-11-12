import test from 'node:test';
import assert from 'node:assert/strict';
import { liquidationPrice, collateralRatio, suggestProtection } from './troveProtect.mjs';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('liquidation price = debt * MCR / collateral', () => {
  close(liquidationPrice(1, 50000), 55000);          // 1 BTC, $50k debt -> $55k
  close(liquidationPrice(2, 100000), 55000);
  assert.equal(liquidationPrice(0, 50000), 0);
  assert.equal(liquidationPrice(1, 0), 0);
});

test('collateral ratio', () => {
  close(collateralRatio(1, 50000, 100000), 2);
  assert.equal(collateralRatio(1, 0, 100000), Infinity);
});

test('suggests a put 15% above liquidation covering all collateral', () => {
  const s = suggestProtection({ coll: 1, debt: 50000, spot: 100000 });
  assert.equal(s.strike, Math.round(55000 * 1.15)); // 63250
  assert.equal(s.qty, 1);
  assert.equal(s.otm, true);
  close(s.payoutAtLiq, (63250 - 55000) * 1);
  close(s.payoutPctOfDebt, 8250 / 50000);
  close(s.icr, 2);
  assert.equal(s.capped, false);
});

test('coverage scales quantity and is clamped to [0,1]', () => {
  assert.equal(suggestProtection({ coll: 2, debt: 50000, spot: 100000, coverage: 0.5 }).qty, 1);
  assert.equal(suggestProtection({ coll: 2, debt: 50000, spot: 100000, coverage: 3 }).qty, 2);
  assert.equal(suggestProtection({ coll: 2, debt: 50000, spot: 100000, coverage: -1 }).qty, 0);
});

test('caps quantity so strike*qty stays within the pool collateral cap', () => {
  const s = suggestProtection({ coll: 1, debt: 50000, spot: 100000, maxCollateral: 10000 });
  assert.equal(s.capped, true);
  assert.ok(s.strike * s.qty <= 10000);
  close(s.qty, Math.floor((10000 / 63250) * 1e6) / 1e6);
});

test('flags an already-in-the-money suggestion when spot is below the strike', () => {
  const s = suggestProtection({ coll: 1, debt: 50000, spot: 60000 });
  assert.equal(s.otm, false);
});

test('returns null for an empty trove or missing price', () => {
  assert.equal(suggestProtection({ coll: 0, debt: 0, spot: 100000 }), null);
  assert.equal(suggestProtection({ coll: 1, debt: 50000, spot: 0 }), null);
});

test('a loan far from liquidation gets the nearest strike the pool sells, flagged', () => {
  // 0.1713 BTC, 6,441 MUSD debt: liquidation ~$41,360, so 15% above is ~$47,560 (35% below a $73,300 spot)
  const s = suggestProtection({ coll: 0.1713, debt: 6441, spot: 73300, strikeBandBps: 3000 });
  assert.equal(s.farFromLiq, true);
  assert.equal(s.strike, 52000);                       // 73,300 x 0.7 = 51,310, rounded up to a $1,000 strike
  assert.ok(s.payoutAtLiq > 0);
  const near = suggestProtection({ coll: 1, debt: 50000, spot: 74000, strikeBandBps: 3000 }); // liq $55k -> $63,250
  assert.equal(near.farFromLiq, false);
  assert.equal(near.strike, 63250);
});

test('size is capped to what the pool can sell now', () => {
  const s = suggestProtection({ coll: 0.1713, debt: 6441, spot: 73300, strikeBandBps: 3000, maxQty: 0.033 });
  assert.equal(s.qty, 0.033);
  assert.equal(s.capped, true);
});
