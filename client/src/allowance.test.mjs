import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureAllowance } from './allowance.mjs';

// A fake MUSD token: records approvals, tracks allowance per (owner, spender).
function fakeToken(owner, initial = 0n) {
  const allowances = new Map([[`${owner}:POOL`, initial]]);
  const approvals = [];
  return {
    approvals,
    runner: { getAddress: async () => owner },
    allowance: async (o, s) => allowances.get(`${o}:${s}`) ?? 0n,
    approve: async (s, amt) => { approvals.push([s, amt]); allowances.set(`${owner}:${s}`, amt); return { wait: async () => ({ status: 1 }) }; },
  };
}

test('ensureAllowance skips the approval when the allowance already covers the amount', async () => {
  const t = fakeToken('0xA', 500n);
  assert.equal(await ensureAllowance(t, 'POOL', 500n), false);   // exactly enough
  assert.equal(await ensureAllowance(t, 'POOL', 100n), false);   // more than enough
  assert.equal(t.approvals.length, 0);
});

test('ensureAllowance approves the exact amount (never unlimited) when the allowance is too low', async () => {
  const t = fakeToken('0xA', 10n);
  assert.equal(await ensureAllowance(t, 'POOL', 250n), true);
  assert.deepEqual(t.approvals, [['POOL', 250n]]);
  assert.equal(await ensureAllowance(t, 'POOL', 250n), false);   // now covered: no second approval
});
