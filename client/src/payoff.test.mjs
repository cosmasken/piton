import test from 'node:test';
import assert from 'node:assert/strict';
import { collateralFor, legPnl, maxGain, maxLoss, breakEven, payoffCurve } from './payoff.mjs';
import { bsPrice } from './greeks.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('collateral matches the contract', () => {
  assert.equal(collateralFor(false, 100000, 90000, 0.1), 9000);          // put: strike x qty
  assert.equal(collateralFor(true, 100000, 90000, 0.1), 21000);          // call: (3 x spot - strike) x qty
  assert.equal(collateralFor(true, 100000, 400000, 0.1), 0);             // strike above the cap: never pays
});

const buyPut = { side: 'buy', isCall: false, strike: 100000, qty: 0.1, premium: 300, collateral: 10000 };
const sellPut = { ...buyPut, side: 'sell' };
const buyCall = { side: 'buy', isCall: true, strike: 100000, qty: 0.1, premium: 400, collateral: 20000 };

test('buyer: loses the premium when out of the money, gains intrinsic minus premium when in the money', () => {
  close(legPnl(buyPut, 120000), -300);
  close(legPnl(buyPut, 90000), 1000 - 300);
  close(legPnl(buyCall, 130000), 3000 - 400);
});

test('seller keeps premium less the 2% fee, pays out intrinsic, never more than collateral', () => {
  close(legPnl(sellPut, 120000), 294);
  close(legPnl(sellPut, 90000), 294 - 1000);
  close(legPnl(sellPut, 0), 294 - 10000);                                  // worst case: collateral lost
  close(legPnl({ ...buyCall, side: 'sell', collateral: 1000 }, 500000), 392 - 1000); // capped at collateral
});

test('max gain / max loss / break-even', () => {
  close(maxLoss(buyPut), 300); close(maxGain(buyPut), 9700);
  close(maxGain(sellPut), 294); close(maxLoss(sellPut), 9706);
  close(breakEven(buyPut), 97000); close(breakEven(buyCall), 104000);
  close(breakEven(sellPut), 97060);
  assert.equal(breakEven({ ...buyPut, premium: 20000 }), null);
});

test('payoff curve is centred on spot and ends at the range limits', () => {
  const c = payoffCurve(buyPut, 100000, 5, 40);
  assert.deepEqual(c.map(p => p.S), [60000, 80000, 100000, 120000, 140000]);
  close(c[2].pnl, -300);
});

test('client Black-Scholes agrees with the textbook value and put-call parity', () => {
  close(bsPrice(true, 100, 100, 8760, 0.2, 0.05), 10.4506, 1e-3);
  close(bsPrice(false, 100, 100, 8760, 0.2, 0.05), 5.5735, 1e-3);
  const c = bsPrice(true, 70000, 65000, 72, 0.5), p = bsPrice(false, 70000, 65000, 72, 0.5);
  close(c - p, 70000 - 65000 * Math.exp(-0.05 * 72 / 8760), 0.01);
  assert.equal(bsPrice(true, 100, 90, 0, 0.5), 10);                        // expired = intrinsic
});
