import test from 'node:test';
import assert from 'node:assert/strict';
import { expirySlots, expiryLabel, zoneLabel, instrumentName, instrumentId, parseInstrumentId, strikeLadder, atmStrike, bookFor, bestQuotes, extraExpiries } from './instruments.mjs';

const Z = '0x0000000000000000000000000000000000000000';
const A = '0x00000000000000000000000000000000000000a1', B = '0x00000000000000000000000000000000000000b2';
const E = v => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
const T0 = Date.UTC(2026, 10, 10, 20, 30) / 1000; // 10 Nov 2026 20:30 UTC (Tuesday)

test('mainnet schedule: daily 08:00 UTC for a week, then Fridays, nothing intraday', () => {
  const s = expirySlots(T0);                                  // default = mainnet schedule
  assert.deepEqual([...s].sort((a, b) => a - b), s);
  assert.equal(new Set(s).size, s.length);
  assert.ok(s.every(t => t >= T0 + 65 * 60 && t <= T0 + 14 * 86400));
  assert.ok(s.every(t => new Date(t * 1000).getUTCHours() === 8));
  assert.equal(expiryLabel(s[0]), '11 NOV 08:00');            // first daily slot (more than an hour away)
  assert.ok(s.includes(Date.UTC(2026, 10, 17, 8) / 1000));    // a week out
  assert.ok(s.includes(Date.UTC(2026, 10, 20, 8) / 1000));    // Friday 20 Nov (beyond a week)
  assert.ok(!s.includes(Date.UTC(2026, 10, 19, 8) / 1000));   // Thursday 19 Nov (beyond a week, not Friday)
  assert.equal(s.length, 8);                                  // 11..17 Nov daily + Fri 20 Nov
});

test('testnet schedule adds six 30-minute slots, the first at least 20 minutes away', () => {
  const cfg = { shortEveryMin: 30, shortCount: 6, dailyDays: 7, fridaysToDays: 14 };
  const s = expirySlots(T0, cfg);                             // T0 = 20:30 UTC
  const short = s.filter(t => t < T0 + 4 * 3600);
  assert.deepEqual(short.map(expiryLabel), ['10 NOV 21:00', '10 NOV 21:30', '10 NOV 22:00', '10 NOV 22:30', '10 NOV 23:00', '10 NOV 23:30']);
  const atEdge = expirySlots(Date.UTC(2026, 10, 10, 20, 45) / 1000, cfg);   // 20:45: 21:00 is only 15 min away
  assert.equal(expiryLabel(atEdge[0]), '10 NOV 21:30');
  assert.ok(s.includes(Date.UTC(2026, 10, 11, 8) / 1000));    // daily slots still there
});

test('the daily slot under an hour away is skipped (pool minimum)', () => {
  const s = expirySlots(Date.UTC(2026, 10, 11, 7, 30) / 1000); // 07:30 UTC
  assert.equal(expiryLabel(s[0]), '12 NOV 08:00');
});

test('instrument names and ids round-trip', () => {
  const i = { isCall: false, strike: 75000, expiry: Date.UTC(2026, 10, 28, 8) / 1000 };
  assert.equal(instrumentName(i), 'BTC-28NOV-75000-P');
  assert.equal(instrumentName({ ...i, isCall: true, expiry: Date.UTC(2026, 10, 10, 22) / 1000 }), 'BTC-10NOV-2200-75000-C');
  assert.deepEqual(parseInstrumentId(instrumentId(i)), i);
  assert.equal(parseInstrumentId('X-1-2'), null);
  assert.equal(parseInstrumentId(null), null);
});

test('strike ladder: round steps, within +-20%, extras included', () => {
  const k = strikeLadder(73000);
  assert.ok(k.every(x => x % 2000 === 0));
  assert.ok(k[0] >= 73000 * 0.8 - 2000 && k[k.length - 1] <= 73000 * 1.2);
  assert.equal(atmStrike(k, 73100), 74000);
  assert.ok(strikeLadder(73000, [31337]).includes(31337));
  assert.deepEqual(strikeLadder(0, [5, 3]), [3, 5]);
});

const mk = (id, type, strike, expiry, long, short, prem, qty, status = 0n) =>
  ({ id: BigInt(id), optionType: BigInt(type), status, long, short, strike: E(strike), expiry: BigInt(expiry), premium: E(prem), quantity: E(qty) });

test('book: separates asks and bids, prices per BTC, sorted, ignores other instruments', () => {
  const ex = 1000;
  const opts = [
    mk(1, 1, 75000, ex, Z, A, 50, 0.1),     // put ask 500/BTC
    mk(2, 1, 75000, ex, Z, B, 30, 0.1),     // put ask 300/BTC
    mk(3, 1, 75000, ex, A, Z, 20, 0.1),     // put bid 200/BTC
    mk(4, 1, 75000, ex, B, Z, 25, 0.1),     // put bid 250/BTC
    mk(5, 0, 75000, ex, A, Z, 99, 0.1),     // call: other side
    mk(6, 1, 76000, ex, A, Z, 99, 0.1),     // other strike
    mk(7, 1, 75000, 2000, A, Z, 99, 0.1),   // other expiry
    mk(8, 1, 75000, ex, A, B, 10, 0.1, 1n), // filled: not on the book
  ];
  const b = bookFor(opts, { isCall: false, strike: 75000, expiry: ex });
  assert.deepEqual(b.asks.map(x => x.id), [2n, 1n]);
  assert.deepEqual(b.bids.map(x => x.id), [4n, 3n]);
  assert.equal(Math.round(b.bestAsk.price), 300);
  assert.equal(Math.round(b.bestBid.price), 250);
});

test('chain quotes: best bid and ask per strike and side', () => {
  const ex = 1000;
  const q = bestQuotes([
    mk(1, 1, 75000, ex, Z, A, 50, 0.1), mk(2, 1, 75000, ex, Z, B, 30, 0.1),
    mk(3, 1, 75000, ex, A, Z, 20, 0.1), mk(4, 0, 80000, ex, B, Z, 10, 0.1),
  ], ex);
  assert.equal(Math.round(q[75000].put.ask), 300);
  assert.equal(Math.round(q[75000].put.bid), 200);
  assert.equal(Math.round(q[80000].call.bid), 100);
  assert.equal(q[80000].call.ask, null);
});

test('extra expiries: live orders on non-standard expiries stay reachable', () => {
  const opts = [mk(1, 1, 75000, 5000, A, Z, 1, 1), mk(2, 1, 75000, 6000, A, Z, 1, 1, 2n), mk(3, 1, 75000, 100, A, Z, 1, 1)];
  assert.deepEqual(extraExpiries(opts, [7000], 200), [5000]);
});

test('times: one expiry, labelled per user; names stay UTC', () => {
  const t = Date.UTC(2026, 10, 12, 8) / 1000;                       // 12 Nov 2026 08:00 UTC
  assert.equal(expiryLabel(t), '12 NOV 08:00');                     // default stays UTC
  assert.equal(expiryLabel(t, true), '12 NOV 08:00');
  assert.equal(zoneLabel(t, true, 180), 'UTC');                     // UTC mode ignores the local offset
  assert.equal(zoneLabel(t, false, 180), 'UTC+3');
  assert.equal(zoneLabel(t, false, 240), 'UTC+4');
  assert.equal(zoneLabel(t, false, -540), 'UTC−9');
  assert.equal(zoneLabel(t, false, 330), 'UTC+5:30');
  assert.equal(zoneLabel(t, false, 0), 'UTC');
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'Africa/Nairobi';                              // UTC+3
    assert.equal(expiryLabel(t, false), '12 NOV 11:00');
    assert.equal(zoneLabel(t, false), 'UTC+3');
    process.env.TZ = 'America/Anchorage';                           // UTC−9 in November
    assert.equal(expiryLabel(t, false), '11 NOV 23:00');            // the day before, same moment
    assert.equal(zoneLabel(t, false), 'UTC−9');
    assert.equal(instrumentName({ isCall: false, strike: 74000, expiry: t }), 'BTC-12NOV-74000-P'); // not local
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});
