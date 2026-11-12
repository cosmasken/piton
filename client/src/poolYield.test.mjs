import test from 'node:test';
import assert from 'node:assert/strict';
import { annualisedReturn, historyDays, yieldBreakdown } from './poolYield.mjs';

const DAY = 86400, NOW = 1_800_000_000;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('annualised return: share price growth over the window, simple annual rate', () => {
  const snaps = [
    { periodStart: NOW - 40 * DAY, sharePrice: '1.000' },
    { periodStart: NOW - 30 * DAY, sharePrice: '1.010' },
    { periodStart: NOW - 8 * DAY, sharePrice: '1.020' },
    { periodStart: NOW - 2 * DAY, sharePrice: '1.025' },
  ];
  // 7 days: base is the last snapshot at or before now-7d (the one 8 days ago, 1.020), span 8 days
  close(annualisedReturn(snaps, { nowSec: NOW, sharePrice: 1.0251, days: 7 }), (1.0251 / 1.020 - 1) * 365 / 8);
  // 30 days: base 1.010 exactly 30 days ago
  close(annualisedReturn(snaps, { nowSec: NOW, sharePrice: 1.0251, days: 30 }), (1.0251 / 1.010 - 1) * 365 / 30);
});

test('annualised return is null until there is enough history, or without data', () => {
  const young = [{ periodStart: NOW - 3 * DAY, sharePrice: '1' }];
  assert.equal(annualisedReturn(young, { nowSec: NOW, sharePrice: 1.01, days: 7 }), null);
  assert.equal(annualisedReturn([], { nowSec: NOW, sharePrice: 1.01, days: 7 }), null);
  assert.equal(annualisedReturn(null, { nowSec: NOW, sharePrice: 1.01, days: 7 }), null);
  assert.equal(annualisedReturn(young, { nowSec: NOW, sharePrice: NaN, days: 1 }), null);
  close(historyDays(young, NOW), 3);
  assert.equal(historyDays([], NOW), 0);
});

test('a loss shows as a negative rate', () => {
  const snaps = [{ periodStart: NOW - 10 * DAY, sharePrice: '1.00' }];
  assert.ok(annualisedReturn(snaps, { nowSec: NOW, sharePrice: 0.99, days: 7 }) < 0);
});

test('yield breakdown: premiums kept after payouts, plus savings, less the performance fee', () => {
  const b = yieldBreakdown({ premiumsEarned: 166.09, unearnedPremium: 6.09, settlementsPaid: 131.28, savingsYield: 3.5, performanceFeesPaid: 5.22 });
  close(b.options, 166.09 - 6.09 - 131.28);
  close(b.savings, 3.5);
  close(b.fees, 5.22);
  close(b.net, b.options + 3.5 - 5.22);
  // pools without the savings module report null savings
  assert.equal(yieldBreakdown({ premiumsEarned: 10, unearnedPremium: 0, settlementsPaid: 0, savingsYield: null, performanceFeesPaid: 0 }).savings, 0);
  assert.equal(yieldBreakdown(null), null);
});
