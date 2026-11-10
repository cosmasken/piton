import test from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, ZERO_ADDRESS, isLive, getNetwork, networkByChainId, resolveInitialNetwork, explorerTx } from './network.mjs';

test('testnet is live (real pool + yMUSD addresses)', () => {
  assert.equal(isLive(NETWORKS.testnet), true);
});

test('mainnet is not live while pool/yMUSD are zero placeholders', () => {
  assert.equal(NETWORKS.mainnet.addresses.pool, ZERO_ADDRESS);
  assert.equal(isLive(NETWORKS.mainnet), false);
});

test('replacing the placeholders makes a network live (no other change needed)', () => {
  const deployed = { ...NETWORKS.mainnet, addresses: { ...NETWORKS.mainnet.addresses,
    pool: '0x1111111111111111111111111111111111111111', ymusd: '0x2222222222222222222222222222222222222222' } };
  assert.equal(isLive(deployed), true);
});

test('missing, malformed or half-filled addresses are not live', () => {
  const m = NETWORKS.mainnet;
  assert.equal(isLive(null), false);
  assert.equal(isLive({ ...m, addresses: { ...m.addresses, pool: undefined } }), false);
  assert.equal(isLive({ ...m, addresses: { ...m.addresses, pool: '0x123' } }), false);
  assert.equal(isLive({ ...m, addresses: { ...m.addresses, pool: '0x1111111111111111111111111111111111111111' } }), false); // ymusd still zero
});

test('only testnet has a faucet', () => {
  assert.ok(NETWORKS.testnet.faucetUrl);
  assert.equal(NETWORKS.mainnet.faucetUrl, null);
});

test('initial network: URL param, then saved choice, then default; invalid values ignored', () => {
  assert.equal(resolveInitialNetwork('?network=mainnet', 'testnet'), 'mainnet');
  assert.equal(resolveInitialNetwork('', 'mainnet'), 'mainnet');
  assert.equal(resolveInitialNetwork('?network=bogus', 'mainnet'), 'mainnet');
  assert.equal(resolveInitialNetwork('?network=bogus', 'nope'), 'testnet');
  assert.equal(resolveInitialNetwork(), 'testnet');
});

test('lookups', () => {
  assert.equal(networkByChainId(31611).key, 'testnet');
  assert.equal(networkByChainId('31612').key, 'mainnet');
  assert.equal(networkByChainId(1), null);
  assert.equal(getNetwork('nope').key, 'testnet');
  assert.equal(explorerTx('mainnet', '0xabc'), 'https://explorer.mezo.org/tx/0xabc');
});
