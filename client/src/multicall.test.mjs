import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { multicall, MC_IFACE, MULTICALL3 } from './multicall.js';

const iface = new ethers.Interface(['function v(uint256) view returns (uint256)']);
// Fake RPC: answers aggregate3 by echoing each call's argument x 10; odd arguments "fail".
function fakeProvider(log) {
  return {
    call: async ({ to, data }) => {
      assert.equal(to, MULTICALL3);
      const [calls] = MC_IFACE.decodeFunctionData('aggregate3', data);
      log.push(calls.length);
      await new Promise(r => setTimeout(r, Math.random() * 10)); // chunks finish out of order
      const res = calls.map(c => {
        const [x] = iface.decodeFunctionData('v', c.callData);
        return x % 2n ? [false, '0x'] : [true, iface.encodeFunctionResult('v', [x * 10n])];
      });
      return MC_IFACE.encodeFunctionResult('aggregate3', [res]);
    },
  };
}

test('multicall keeps order across parallel chunks and maps failures to null', async () => {
  const log = [];
  const calls = Array.from({ length: 11 }, (_, i) => ({ target: ethers.ZeroAddress, iface, fn: 'v', args: [i] }));
  const r = await multicall(fakeProvider(log), calls, 4);
  assert.deepEqual(log.sort(), [3, 4, 4]);                      // 11 calls in chunks of 4
  assert.deepEqual(r.map(x => (x == null ? null : Number(x))), [0, null, 20, null, 40, null, 60, null, 80, null, 100]);
});
