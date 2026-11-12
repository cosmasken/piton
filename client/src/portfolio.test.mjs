import test from 'node:test';
import assert from 'node:assert/strict';
import { livePositions, realisedPnl, lpPosition, poolExposure, expiryAlerts, toCsv, seriesLocked, holderCosts } from './portfolio.mjs';

const E = v => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
const ME = '0x00000000000000000000000000000000000000aa', POOL = '0x00000000000000000000000000000000000000bb', OTHER = '0x00000000000000000000000000000000000000cc';
const opt = (id, type, strike, expiry, qty, prem, long, short, extra = {}) => ({
  id: BigInt(id), optionType: BigInt(type), status: 1n, strike: E(strike), expiry: BigInt(expiry), quantity: E(qty), premium: E(prem),
  long, short, collateral: E(extra.coll ?? strike * qty), filledByPool: short === POOL, ...extra,
});
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('live positions: long and short signs, totals, ignores others and expired', () => {
  const now = 1000, exp = now + 86400;
  const opts = [
    opt(1, 1, 74000, exp, 0.01, 8, ME, POOL),          // my long put
    opt(2, 0, 76000, exp, 0.01, 3, OTHER, ME),         // my short call (peer to peer)
    opt(3, 1, 74000, exp, 1, 1, OTHER, POOL),          // not mine
    opt(4, 1, 74000, now - 1, 1, 1, ME, POOL),         // expired
  ];
  const { rows, totals } = livePositions(opts, ME, 73000, 0.4, now);
  assert.equal(rows.length, 2);
  const put = rows.find(r => !r.isCall), call = rows.find(r => r.isCall);
  assert.ok(put.isLong && put.delta < 0 && put.gamma > 0 && put.itm);   // long put: negative delta, positive gamma
  assert.ok(!call.isLong && call.delta < 0 && call.gamma < 0);           // short call: negative delta and gamma
  close(totals.delta, put.delta + call.delta);
  close(totals.premiumAtRisk, 8);
  close(totals.collateralLocked, 760);
  close(totals.pnl, put.mark - 8 + (3 * 0.98 - call.mark));
});

test('realised P&L from ended options', () => {
  const r = realisedPnl([
    { id: '1', status: 'SETTLED', long: { id: ME }, short: POOL, premium: '8', payout: '20' },   // +12
    { id: '2', status: 'REFUNDED', long: { id: ME }, short: POOL, premium: '5', payout: '0' },   // -5
    { id: '3', status: 'CLOSED', long: { id: ME }, short: POOL, premium: '4', payout: '3' },     // -1 (sold back)
    { id: '4', status: 'REFUNDED', long: { id: OTHER }, short: ME, premium: '10', payout: '0' }, // +9.8 (I sold it)
    { id: '5', status: 'FILLED', long: { id: ME }, short: POOL, premium: '9', payout: '0' },     // live: ignored
    { id: '6', status: 'CANCELLED', long: null, short: ME, premium: '9', payout: '0' },          // ignored
  ], ME);
  close(r.total, 12 - 5 - 1 + 9.8);
  assert.equal(r.rows.length, 4);
});

test('realised P&L with resales: the new holder counts what they paid, the seller counts the resale', () => {
  const r = realisedPnl([
    // bought on resale for 6 (original premium 8), exercised for 20: +14
    { id: '7', status: 'SETTLED', long: { id: ME }, short: POOL, premium: '8', holderCost: '6', payout: '20' },
  ], ME, [
    { option: { id: '8' }, seller: { id: ME }, price: '10', sellerCost: '7' },      // sold on for 10 (9.8 net): +2.8
    { option: { id: '9' }, seller: { id: OTHER }, price: '50', sellerCost: '1' },  // someone else's resale: ignored
  ]);
  close(r.total, 14 + 2.8);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].resale, true);
});

test('LP position: value, P&L and share of the pool', () => {
  const p = lpPosition({ deposited: '2500', withdrawn: '300.03' }, 2200, 1.0001, 2200);
  close(p.value, 2200.22); close(p.pnl, 2200.22 + 300.03 - 2500); close(p.sharePct, 100);
  close(lpPosition(undefined, 0, 1, 0).pnl, 0);
});

test('pool exposure groups live pool-sold options by expiry and strike', () => {
  const now = 1000;
  const x = poolExposure([
    opt(1, 1, 74000, 5000, 0.01, 8, ME, POOL), opt(2, 0, 74000, 5000, 0.02, 8, OTHER, POOL, { coll: 100 }),
    opt(3, 1, 70000, 9000, 0.01, 8, ME, POOL), opt(4, 1, 70000, 9000, 1, 1, ME, OTHER), opt(5, 1, 70000, 500, 1, 1, ME, POOL),
  ], POOL, now);
  close(x.collateral, 740 + 100 + 700);
  assert.equal(x.byExpiry[5000].count, 2); close(x.byExpiry[9000].collateral, 700);
  close(x.byStrike[74000].call, 0.02); close(x.byStrike[74000].put, 0.01);
});

test('expiry alerts: long, in the money, auto-exercise off, inside the window', () => {
  const now = 1000;
  const rows = [
    { id: 1n, isLong: true, itm: true, expiry: now + 1800 },
    { id: 2n, isLong: true, itm: true, expiry: now + 1800 },     // auto on
    { id: 3n, isLong: true, itm: false, expiry: now + 1800 },    // out of the money
    { id: 4n, isLong: false, itm: true, expiry: now + 1800 },    // short
    { id: 5n, isLong: true, itm: true, expiry: now + 7200 },     // too far
  ];
  assert.deepEqual(expiryAlerts(rows, { 2: true }, now).map(r => r.id), [1n]);
});

test('CSV quoting', () => {
  assert.equal(toCsv(['a', 'b'], [[1, 'x,y'], ['say "hi"', null]]), 'a,b\n1,"x,y"\n"say ""hi""",\n');
});

test('series locked: live pool-sold options of one type, strike and expiry', () => {
  const E = v => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
  const o = (id, type, strike, expiry, collateral, extra = {}) => ({ id, optionType: BigInt(type), status: 1n, filledByPool: true,
    strike: E(strike), expiry: BigInt(expiry), collateral: E(collateral), ...extra });
  const opts = [
    o(1n, 1, 74000, 5000, 740), o(2n, 1, 74000, 5000, 370),
    o(3n, 1, 74000, 5000, 999, { filledByPool: false }),       // peer to peer: not the pool's
    o(4n, 0, 74000, 5000, 999), o(5n, 1, 75000, 5000, 999), o(6n, 1, 74000, 6000, 999),
    o(7n, 1, 74000, 5000, 999, { status: 2n }),                 // settled
  ];
  const s = seriesLocked(opts, { isCall: false, strike: 74000, expiry: 5000 }, 1000);
  assert.ok(Math.abs(s.collateral - 1110) < 1e-9);
  assert.equal(s.open, true);
  assert.equal(seriesLocked(opts, { isCall: false, strike: 73000, expiry: 5000 }, 1000).open, false);
  assert.equal(seriesLocked(opts, { isCall: false, strike: 74000, expiry: 5000 }, 5000).open, false);   // expired
});

test('holder costs: what this wallet paid for options it holds after a resale', () => {
  const h = { ended: [{ id: '1', long: { id: ME }, holderCost: '12.5' }, { id: '2', long: { id: OTHER }, holderCost: '3' }, { id: '3', long: { id: ME }, holderCost: '0' }] };
  assert.deepEqual(holderCosts(h, ME), { 1: 12.5 });
  assert.deepEqual(holderCosts(null, ME), {});
});
