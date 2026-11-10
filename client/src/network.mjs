// Single source of truth for which Mezo network the app talks to.
// Pure module (no imports) so it can be unit-tested with `node --test`.
//
// Going live on a network = replace its ZERO pool/ymusd placeholders with the deployed addresses.
// isLive() then returns true and the "not live" banner disappears; nothing else needs to change.

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DEFAULT_NETWORK = 'testnet';
export const NETWORK_STORAGE_KEY = 'piton_network';

export const NETWORKS = {
  testnet: {
    key: 'testnet',
    label: 'Testnet',
    chain: {
      id: 31611,
      name: 'Mezo Matsnet',
      nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
      blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.test.mezo.org' } },
      testnet: true,
    },
    isTestnet: true,
    explorer: 'https://explorer.test.mezo.org',
    faucetUrl: 'https://faucet.test.mezo.org',
    borrowUrl: 'https://testnet.mezo.org',
    addresses: {
      pool:            '0xe27c6a15D947757Ae7bcc945063C45C650B3F357',
      deployBlock:     16698861, // first block to scan for trade history
      ymusd:           '0x00967781f41728A8d5BD64D2EeFd75e28F5f0246',
      musd:            '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
      oracle:          '0x7b7c000000000000000000000000000000000015',
      troveManager:    '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
      borrowerOpsSigs: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e',
    },
  },
  mainnet: {
    key: 'mainnet',
    label: 'Mainnet',
    chain: {
      id: 31612,
      name: 'Mezo Mainnet',
      nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 },
      // Mezo-recommended public RPC (mezo.org/docs/developers/getting-started)
      rpcUrls: { default: { http: ['https://mainnet.mezo.public.validationcloud.io'] } },
      blockExplorers: { default: { name: 'Mezo Explorer', url: 'https://explorer.mezo.org' } },
    },
    isTestnet: false,
    explorer: 'https://explorer.mezo.org',
    faucetUrl: null,
    borrowUrl: 'https://mezo.org/borrow',
    addresses: {
      // Piton is not deployed on mainnet yet: placeholders keep the app in "not live" mode.
      pool:            ZERO_ADDRESS,
      ymusd:           ZERO_ADDRESS,
      // Mezo's own mainnet contracts (mezo.org/docs, mezo-org/musd deployments)
      musd:            '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
      oracle:          '0x7b7c000000000000000000000000000000000015',
      troveManager:    '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193',
      borrowerOpsSigs: '0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a',
    },
  },
};

const isRealAddress = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() !== ZERO_ADDRESS;

/** True when Piton's contracts are deployed on this network (pool and LP token are real addresses). */
export function isLive(network) {
  const a = network && network.addresses;
  return !!a && isRealAddress(a.pool) && isRealAddress(a.ymusd);
}

export function getNetwork(key) {
  return NETWORKS[key] || NETWORKS[DEFAULT_NETWORK];
}

export function networkByChainId(chainId) {
  return Object.values(NETWORKS).find(n => n.chain.id === Number(chainId)) || null;
}

/**
 * Which network to start on: a valid `?network=` URL parameter wins, then the user's saved
 * choice, then the default.
 */
export function resolveInitialNetwork(search = '', stored = null) {
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(search).get('network'); } catch { /* ignore */ }
  if (fromUrl && NETWORKS[fromUrl]) return fromUrl;
  if (stored && NETWORKS[stored]) return stored;
  return DEFAULT_NETWORK;
}

export const explorerTx = (key, hash) => `${getNetwork(key).explorer}/tx/${hash}`;
export const explorerAddress = (key, addr) => `${getNetwork(key).explorer}/address/${addr}`;
