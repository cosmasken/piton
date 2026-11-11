import test from 'node:test';
import assert from 'node:assert/strict';
import { openInterest, volume24h, inUnit, fmtUnit } from './market.mjs';
import { greeks, bsPrice, impliedVol } from './greeks.js';

const E = v => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
const opt = (id, type, strike, expiry, qty, prem, status = 1n) =>
  ({ id: BigInt(id), optionType: BigInt(type), status, strike: E(strike), expiry: BigInt(expiry), quantity: E(qty), premium: E(prem) });
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('open interest counts only live filled options, by side and strike', () => {
  const now = 1000;
  const oi = openInterest([
    opt(1, 0, 75000, 5000, 0.1, 10), opt(2, 1, 75000, 5000, 0.3, 10), opt(3, 1, 70000, 5000, 0.2, 5),
    opt(4, 1, 70000, 900, 1, 1),            // expired
    opt(5, 0, 75000, 5000, 1, 1, 0n),       // open order, not a position
    opt(6, 0, 75000, 5000, 1, 1, 4n),       // sold back
    opt(7, 0, 80000, 6000, 0.4, 1),         // other expiry
  ], now, 5000);
  close(oi.calls, 0.5, 1e-9); close(oi.puts, 0.5, 1e-9); close(oi.total, 1, 1e-9); close(oi.putCallRatio, 1, 1e-9);
  assert.deepEqual(Object.keys(oi.byStrike).sort(), ['70000', '75000']);
  close(oi.byStrike[75000].put, 0.3, 1e-9);
  assert.equal(openInterest([], now).putCallRatio, null);
});

test('24h volume uses trades in the window and their option sizes', () => {
  const now = 100000;
  const options = [opt(1, 0, 75000, 200000, 0.1, 12), opt(2, 1, 74000, 200000, 0.2, 8), opt(3, 1, 74000, 300000, 1, 99)];
  const v = volume24h([{ id: 1n, time: now - 60 }, { id: 2n, time: now - 3600 }, { id: 3n, time: now - 90000 }, { id: 9n, time: now }], options, now, 200000);
  assert.equal(v.count, 2); close(v.qty, 0.3, 1e-9); close(v.premium, 20, 1e-9);
  close(v.byStrike[74000].put, 0.2, 1e-9);
});

test('price units: MUSD, BTC and % of spot', () => {
  assert.equal(inUnit(740, 74000, 'musd'), 740);
  close(inUnit(740, 74000, 'btc'), 0.01, 1e-12);
  close(inUnit(740, 74000, 'pct'), 1, 1e-12);
  assert.equal(inUnit(null, 74000, 'btc'), null);
  assert.equal(fmtUnit(0.01, 'btc'), '0.0100');
  assert.equal(fmtUnit(1, 'pct'), '1.00%');
  assert.equal(fmtUnit(12345, 'musd'), '12,345');
});

test('greeks: gamma and vega are positive and peak near the money; implied vol round-trips', () => {
  const atm = greeks(true, 74000, 74000, 48, 0.5), otm = greeks(true, 74000, 90000, 48, 0.5);
  assert.ok(atm.gamma > otm.gamma && atm.vega > otm.vega && atm.vega > 0);
  close(greeks(true, 74000, 74000, 48, 0.5).gamma, greeks(false, 74000, 74000, 48, 0.5).gamma, 1e-9); // same for call and put
  for (const [isCall, k, v] of [[true, 74000, 0.4], [false, 70000, 0.8], [true, 82000, 1.2]]) {
    const p = bsPrice(isCall, 74000, k, 72, v);
    close(impliedVol(isCall, 74000, k, 72, p), v, 1e-4);
  }
  assert.equal(impliedVol(true, 74000, 60000, 72, 100), null);  // below exercise value: no volatility fits
});
