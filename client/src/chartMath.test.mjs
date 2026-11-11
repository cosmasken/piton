import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS, parseKlines, parseKlineMessage, expectedMoveCone, liquidationPrice, fmtTime, fmtTick, uniqueByTime, ivSteps, parseDvol } from './chartMath.mjs';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('intervals cover 5m to 1W with Binance codes', () => {
  assert.deepEqual(INTERVALS.map(i => i.key), ['5m', '15m', '1h', '4h', '1D', '1W']);
  assert.equal(INTERVALS.find(i => i.key === '1D').binance, '1d');
});

test('klines: parsed to seconds, sorted, malformed rows dropped', () => {
  const raw = [
    [1794380400000, '74000.1', '74100', '73900', '74050', '12.5'],
    [1794376800000, '73900', '74010', '73800', '74000.1', '10'],
    [1794384000000, 'x', '1', '1', '1', '1'],
  ];
  const c = parseKlines(raw);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map(x => x.time), [1794376800, 1794380400]);
  assert.equal(c[1].high, 74100);
  assert.deepEqual(parseKlines(null), []);
  const m = parseKlineMessage({ k: { t: 1794380400000, o: '1', h: '2', l: '0.5', c: '1.5', v: '3' } });
  assert.deepEqual(m, { time: 1794380400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 });
  assert.equal(parseKlineMessage({}), null);
});

test('expected-move cone: starts at spot, widens with sqrt(time), ends exactly at expiry', () => {
  const now = 1794380400, exp = now + 365 * 86400;
  const { upper, lower } = expectedMoveCone(70000, 0.4, now, exp, 86400);
  close(upper[0].value, 70000, 1e-6); close(lower[0].value, 70000, 1e-6);
  assert.equal(upper[upper.length - 1].time, exp);
  close(upper[upper.length - 1].value, 70000 * Math.exp(0.4), 1e-6);   // one year at 40% vol
  close(lower[lower.length - 1].value, 70000 / Math.exp(0.4), 1e-6);
  assert.ok(upper.length <= 402);
  assert.ok(upper.every((p, i) => i === 0 || p.time > upper[i - 1].time));  // strictly increasing times
  // a quarter of the time gives half the width (sqrt)
  const q = expectedMoveCone(70000, 0.4, now, now + 365 * 86400 / 4, 3600);
  close(Math.log(q.upper[q.upper.length - 1].value / 70000), 0.2, 1e-9);
  assert.deepEqual(expectedMoveCone(0, 0.4, now, exp, 3600), { upper: [], lower: [] });
});

test('liquidation price uses the 110% minimum collateral ratio', () => {
  close(liquidationPrice(1, 50000), 55000, 1e-9);
  assert.equal(liquidationPrice(0, 100), null);
  assert.equal(liquidationPrice(1, 0), null);
});

test('time labels in UTC', () => {
  const t = Date.UTC(2026, 10, 11, 14, 5) / 1000;
  assert.equal(fmtTime(t, true), '11 Nov 14:05');
  assert.equal(fmtTick(t, true, 'time'), '14:05');
  assert.equal(fmtTick(t, true, 'day'), '11 Nov');
  assert.equal(fmtTick(t, true, 'month'), 'Nov 2026');
  assert.equal(fmtTick(t, true, 'year'), '2026');
});

test('unique times, IV steps carried to now, DVOL parsing', () => {
  assert.deepEqual(uniqueByTime([{ time: 2, value: 1 }, { time: 1, value: 5 }, { time: 2, value: 3 }]), [{ time: 1, value: 5 }, { time: 2, value: 3 }]);
  const s = ivSteps([{ timestamp: '200', iv: '0.4' }, { timestamp: '100', iv: '0.8' }], 500, 1.15);
  assert.deepEqual(s.mid.map(p => p.time), [100, 200, 500]);
  close(s.mid[0].value, 80, 1e-9); close(s.mid[2].value, 40, 1e-9); close(s.ask[2].value, 46, 1e-9);
  assert.deepEqual(ivSteps([], 500).mid, []);
  const d = parseDvol({ result: { data: [[2000, 1, 2, 0, 39.5], [1000, 1, 2, 0, 40.1]] } });
  assert.deepEqual(d, [{ time: 1, value: 40.1 }, { time: 2, value: 39.5 }]);
  assert.deepEqual(parseDvol({}), []);
});
