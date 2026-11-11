import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, lockRemaining, breakerActive, poolWontFill, withdrawEstimate } from './poolRules.mjs';

const P = { strikeDistanceBps: 3000, minPoolExpiry: 900, cbUntil: 0, utilisationBps: 1000, maxUtilisationBps: 8000 };
const base = { spot: 100000, strike: 100000, expirySecs: 3600, nowSec: 1000 };

test('fmtDuration', () => {
  assert.equal(fmtDuration(0), '0s');
  assert.equal(fmtDuration(59.2), '1m 00s');
  assert.equal(fmtDuration(252), '4m 12s');
  assert.equal(fmtDuration(3900), '1h 05m');
  assert.equal(fmtDuration(-5), '0s');
});

test('lock and breaker windows', () => {
  assert.equal(lockRemaining(1500, 1000), 500);
  assert.equal(lockRemaining(900, 1000), 0);
  assert.equal(lockRemaining(undefined, 1000), 0);
  assert.equal(breakerActive(2000, 1000), true);
  assert.equal(breakerActive(1000, 1000), false);
  assert.equal(breakerActive(0, 1000), false);
});

test('a normal order raises no warnings', () => {
  assert.deepEqual(poolWontFill(base, P), []);
});

test('strike band: 30% is allowed, 31% is not, both directions', () => {
  assert.deepEqual(poolWontFill({ ...base, strike: 130000 }, P), []);
  assert.equal(poolWontFill({ ...base, strike: 131000 }, P).length, 1);
  assert.equal(poolWontFill({ ...base, strike: 60000 }, P).length, 1);
});

test('minimum time left, breaker and utilisation each add a reason', () => {
  assert.equal(poolWontFill({ ...base, expirySecs: 600 }, P).length, 1);
  assert.equal(poolWontFill(base, { ...P, cbUntil: 5000 }).length, 1);
  assert.equal(poolWontFill(base, { ...P, utilisationBps: 8000 }).length, 1);
  assert.equal(poolWontFill({ ...base, strike: 50000, expirySecs: 60 }, { ...P, cbUntil: 5000, utilisationBps: 9000 }).length, 4);
});

test('missing data never blocks the user', () => {
  assert.deepEqual(poolWontFill({ spot: 0, strike: 1, expirySecs: 1, nowSec: 1 }, P), []);
  assert.deepEqual(poolWontFill(base, {}), []);
});

test('withdrawal fee only applies while options are open', () => {
  assert.deepEqual(withdrawEstimate(100, 1.05, 25, 0), { gross: 105, fee: 0, net: 105 });
  const w = withdrawEstimate(100, 1, 25, 3);
  assert.equal(w.fee, 0.25);
  assert.equal(w.net, 99.75);
});

test('size limits match the contract: 25% of pool per option, 80% utilisation, absolute cap', () => {
  const P2 = { ...P, totalAssets: 2200, lockedCollateral: 0, maxOptionExposureBps: 2500, maxOptionCollateral: 10000 };
  assert.deepEqual(poolWontFill({ ...base, collateral: 550 }, P2), []);           // exactly 25%: allowed
  assert.equal(poolWontFill({ ...base, collateral: 551 }, P2).length, 1);         // just over
  assert.match(poolWontFill({ ...base, collateral: 740 }, P2)[0], /25% of the pool/);
  assert.equal(poolWontFill({ ...base, collateral: 500 }, { ...P2, lockedCollateral: 1300 }).length, 1); // 1,800 > 80% of 2,200
  assert.deepEqual(poolWontFill({ ...base, collateral: 460 }, { ...P2, lockedCollateral: 1300 }), []);   // 1,760 = 80%
  assert.match(poolWontFill({ ...base, collateral: 20000 }, { ...P2, totalAssets: 1e6 })[0], /at most 10,000/);
  assert.deepEqual(poolWontFill({ ...base, collateral: 740 }, P), []);              // no pool size known: no guess
});
