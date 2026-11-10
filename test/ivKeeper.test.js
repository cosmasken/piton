const { expect } = require('chai');
const { latestDvol, clampIvPct, planUpdate, isStale } = require('../scripts/lib/iv');

const E16 = 10n ** 16n;

describe('IV keeper logic', () => {
  it('reads the latest DVOL close from Deribit data', () => {
    const json = { result: { data: [[1000, 39.2, 40, 39, 39.19], [2000, 39.19, 39.7, 39.1, 39.67]] } };
    expect(latestDvol(json)).to.deep.equal({ pct: 39.67, ts: 2000 });
    expect(latestDvol({ result: { data: [] } })).to.equal(null);
    expect(latestDvol({})).to.equal(null);
    expect(latestDvol({ result: { data: [[1, 0, 0, 0, 'x']] } })).to.equal(null);
  });

  it('clamps to the contract range [25%, 150%]', () => {
    expect(clampIvPct(10)).to.equal(25);
    expect(clampIvPct(200)).to.equal(150);
    expect(clampIvPct(42.5)).to.equal(42.5);
  });

  it('updates only when the change is at least the threshold', () => {
    const p = planUpdate(39.67, 80n * E16);
    expect(p.update).to.equal(true);
    expect(p.targetPct).to.equal(39.67);
    expect(p.targetWei).to.equal(3967n * 10n ** 14n);
    expect(planUpdate(80.5, 80n * E16).update).to.equal(false);
    expect(planUpdate(82, 80n * E16).update).to.equal(true);
  });

  it('flags stale data', () => {
    expect(isStale(0, 4 * 3600 * 1000)).to.equal(true);
    expect(isStale(0, 3600 * 1000)).to.equal(false);
  });
});
