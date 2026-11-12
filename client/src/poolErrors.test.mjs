import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ethers } from 'ethers';
import { POOL_ERRORS, poolRevertReason } from './poolErrors.mjs';

const require = createRequire(import.meta.url);
const abi = require('./contracts/OptionPool.json').abi;
const iface = new ethers.Interface(abi);

test('every OptionPool custom error has a reason, keyed by its selector', () => {
  const errors = abi.filter(x => x.type === 'error' && x.inputs.length === 0 && !/^(Ownable|SafeERC20|ReentrancyGuard)/.test(x.name));
  assert.ok(errors.length >= 60);
  for (const e of errors) {
    const sel = iface.getError(e.name).selector;
    assert.equal(POOL_ERRORS[sel]?.name, e.name, `missing ${e.name}`);
  }
});

test('decodes a decoded custom error, raw revert data, or a nested RPC error', () => {
  assert.equal(poolRevertReason({ revert: { name: 'NotInTheMoney' } }), 'not in the money');
  const data = iface.encodeErrorResult('DepositLocked', []);
  assert.equal(poolRevertReason({ data }), 'deposit locked');
  assert.equal(poolRevertReason({ info: { error: { data: iface.encodeErrorResult('StalePrice', []) } } }), 'stale price');
  assert.equal(poolRevertReason({ message: 'nothing here' }), null);
  assert.equal(poolRevertReason(undefined), null);
});
