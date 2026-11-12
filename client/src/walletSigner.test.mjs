import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { PassportSigner, isBitcoinWalletClient } from './walletSigner.mjs';

const ADDR = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';

// A fake Passport wallet client and a provider that "sees" the relayed transaction after a couple of polls.
function setup({ visibleAfter = 2 } = {}) {
  const sent = [];
  const walletClient = {
    account: { address: ADDR, signMessage: async ({ message }) => `signed:${typeof message === 'string' ? message : 'raw'}` },
    sendBitcoin: async () => 'btc-tx',
    sendTransaction: async req => { sent.push(req); return '0xabc'; },
  };
  let polls = 0;
  const provider = {
    getTransaction: async hash => (++polls >= visibleAfter ? { hash, wait: async () => ({ status: 1 }) } : null),
    getNetwork: async () => ({ chainId: 31611n }),
    resolveName: async n => n,
  };
  return { walletClient, provider, sent, polls: () => polls };
}

test('detects a Passport Bitcoin-wallet client (and not an EVM wallet client)', () => {
  assert.equal(isBitcoinWalletClient({ sendBitcoin() {} }), true);
  assert.equal(isBitcoinWalletClient({ account: {} }), false);
  assert.equal(isBitcoinWalletClient(undefined), false);
});

test('sendTransaction goes through the wallet client and returns the relayed transaction', async () => {
  const { walletClient, provider, sent, polls } = setup();
  const s = new PassportSigner(walletClient, provider, { pollMs: 1 });
  const iface = new ethers.Interface(['function deposit(uint256)']);
  const res = await s.sendTransaction({ to: POOL, data: iface.encodeFunctionData('deposit', [5n]) });
  assert.equal(res.hash, '0xabc');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to.toLowerCase(), POOL);
  assert.equal(sent[0].value, 0n);
  assert.ok(sent[0].data.startsWith(iface.getFunction('deposit').selector));
  assert.ok(polls() >= 2);                                   // waited until the transaction was visible
  assert.equal((await res.wait()).status, 1);
});

test('works as the runner of an ethers Contract (existing app calls keep working)', async () => {
  const { walletClient, provider, sent } = setup({ visibleAfter: 1 });
  const s = new PassportSigner(walletClient, provider, { pollMs: 1 });
  const c = new ethers.Contract(POOL, ['function cancelOrder(uint256)'], s);
  const tx = await c.cancelOrder(7n);
  assert.equal(tx.hash, '0xabc');
  assert.equal(new ethers.Interface(['function cancelOrder(uint256)']).decodeFunctionData('cancelOrder', sent[0].data)[0], 7n);
  assert.equal(await s.getAddress(), ADDR);
});

test('typed-data signatures are refused with a clear message; messages are signed by the Bitcoin wallet', async () => {
  const { walletClient, provider } = setup();
  const s = new PassportSigner(walletClient, provider);
  await assert.rejects(() => s.signTypedData({}, {}, {}), /cannot sign typed data/);
  assert.equal(await s.signMessage('hi'), 'signed:hi');
});

test('gives up with a clear error if the relayed transaction never appears', async () => {
  const { walletClient, provider } = setup({ visibleAfter: 1e9 });
  const s = new PassportSigner(walletClient, provider, { pollMs: 1, attempts: 3 });
  await assert.rejects(() => s.sendTransaction({ to: POOL, data: '0x' }), /not found on Mezo yet/);
});
