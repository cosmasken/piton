import { create } from 'zustand';
import { ethers } from 'ethers';
import OptionPoolABI from './contracts/OptionPool.json';
import yMUSD_ABI    from './contracts/yMUSD.json';
import MUSDABI      from './abi/musd.json';
import { NETWORKS, DEFAULT_NETWORK, NETWORK_STORAGE_KEY, getNetwork, isLive, networkByChainId, resolveInitialNetwork } from './network.mjs';

// Contract addresses by chain id, from the single network config (network.mjs).
export const ADDRESSES = Object.fromEntries(Object.values(NETWORKS).map(n => [n.chain.id, n.addresses]));
const SKIP_ORACLE_ABI  = [
  { name: 'latestRoundData', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [
      { name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ]},
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
];

// Must match OptionPool.PRICE_STALENESS: the contract rejects oracle prices older than this.
export const PRICE_STALENESS_S = 300;

// Read-only providers per network (used before a wallet connects, or when it's on another chain).
const roProviders = {};
const roProvider = key => {
  const n = getNetwork(key);
  return (roProviders[n.key] ||= new ethers.JsonRpcProvider(n.chain.rpcUrls.default.http[0], n.chain.id, { staticNetwork: true }));
};

const initialNetwork = () => {
  try { return resolveInitialNetwork(window.location.search, localStorage.getItem(NETWORK_STORAGE_KEY)); }
  catch { return DEFAULT_NETWORK; }
};

const EMPTY_POOL_STATS = { poolTotalAssets: '—', poolLocked: '—', poolUtilisation: '—', poolShareValue: '—', poolParams: null };

// status enum from contract
export const STATUS = { OPEN: 0n, FILLED: 1n, SETTLED: 2n, REFUNDED: 3n };
export const TYPE   = { CALL: 0n, PUT: 1n };

export const useStore = create((set, get) => ({
  // Network the user selected (testnet | mainnet). Trading only works where Piton is live.
  network:      initialNetwork(),

  setNetwork: (key) => {
    if (!NETWORKS[key] || key === get().network) return;
    try { localStorage.setItem(NETWORK_STORAGE_KEY, key); } catch { /* private mode */ }
    get().reset();
    set({ network: key, btcPrice: 0, oracleStale: false, priceSource: 'oracle' });
    get().fetchPrice();
    get().fetchOptions();
    get().fetchPoolStats();
  },

  provider:     null,
  signer:       null,
  account:      null,
  chainId:      null,

  poolContract:  null,
  ymusdContract: null,
  musdContract:  null,

  btcPrice:    0,
  oracleStale: false,
  priceSource: 'oracle',

  options:       [],
  ordersLoading: false,

  btcBalance:   '—',
  musdBalance:  '—',
  ymusdBalance: '—',

  // pool stats
  poolTotalAssets:    '—',
  poolLocked:         '—',
  poolUtilisation:    '—',
  poolShareValue:     '—',
  // live rules read from the contract (fees, limits, breaker); null until loaded
  poolParams:         null,
  lockExpiry:         0,   // connected account's deposit lock (unix seconds)

  tick: 0,
  refresh: () => set(s => ({ tick: s.tick + 1 })),

  init: (walletClient, chainId) => {
    if (!walletClient || !chainId) return;
    // Only wire contracts when the wallet is on the selected network and Piton is live there.
    const net = networkByChainId(chainId);
    if (!net || net.key !== get().network || !isLive(net)) return;
    const addrs = net.addresses;
    const provider = new ethers.BrowserProvider(walletClient.transport);
    provider.getSigner().then(signer => {
      if (get().network !== net.key) return; // user switched network while the wallet was connecting
      const poolContract  = new ethers.Contract(addrs.pool,  OptionPoolABI.abi, signer);
      const ymusdContract = new ethers.Contract(addrs.ymusd, yMUSD_ABI.abi,    signer);
      const musdContract  = new ethers.Contract(addrs.musd,  MUSDABI.abi,      signer);
      set({ provider, signer, account: walletClient.account.address, chainId,
            poolContract, ymusdContract, musdContract });
      get().fetchAll();
    });
  },

  reset: () => set({
    provider: null, signer: null, account: null, chainId: null,
    poolContract: null, ymusdContract: null, musdContract: null,
    options: [], btcBalance: '—', musdBalance: '—', ymusdBalance: '—', lockExpiry: 0,
    ...EMPTY_POOL_STATS,
  }),

  fetchPrice: async () => {
    // Mezo's Skip oracle on the selected network: via the wallet if connected there, else read-only RPC.
    const { network, provider: walletProvider, chainId } = get();
    const net = getNetwork(network);
    const provider = walletProvider && chainId === net.chain.id ? walletProvider : roProvider(network);
    const stillCurrent = () => get().network === network; // ignore results after a network switch
    try {
      const oracle = new ethers.Contract(net.addresses.oracle, SKIP_ORACLE_ABI, provider);
      const [, answer, , updatedAt] = await oracle.latestRoundData();
      const dec   = await oracle.decimals();
      const price = parseFloat(ethers.formatUnits(answer, dec));
      const age   = Math.floor(Date.now() / 1000) - Number(updatedAt);
      if (!stillCurrent()) return;
      if (age <= PRICE_STALENESS_S) {
        set({ btcPrice: price, oracleStale: false, priceSource: 'oracle' });
        return;
      }
      set({ oracleStale: true });
    } catch {}
    try {
      const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
      if (stillCurrent()) set({ btcPrice: parseFloat(price), priceSource: 'binance' });
    } catch {}
  },

  fetchBalances: async () => {
    const { provider, account, musdContract, ymusdContract, poolContract } = get();
    if (!provider || !account || !musdContract) return;
    try {
      const [b, m, y, lock] = await Promise.all([
        provider.getBalance(account),
        musdContract.balanceOf(account),
        ymusdContract ? ymusdContract.balanceOf(account) : Promise.resolve(0n),
        poolContract ? poolContract.depositLockExpiry(account) : Promise.resolve(0n),
      ]);
      set({
        lockExpiry:   Number(lock),
        btcBalance:   parseFloat(ethers.formatEther(b)).toFixed(4),
        musdBalance:  parseFloat(ethers.formatEther(m)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        ymusdBalance: parseFloat(ethers.formatEther(y)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
      });
    } catch {}
  },

  fetchPoolStats: async () => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net)) { set(EMPTY_POOL_STATS); return; } // never call placeholder (zero) addresses
    const addrs = net.addresses;
    const pool  = new ethers.Contract(addrs.pool,  OptionPoolABI.abi, roProvider(network));
    const ymusd = new ethers.Contract(addrs.ymusd, yMUSD_ABI.abi,    roProvider(network));
    try {
      const [total, locked, util, supply, nav, feeBps, lockSecs, minExp, strikeBps, utilMax, expMax, cbUntil, openN] = await Promise.all([
        pool.totalAssets(),
        pool.lockedCollateral(),
        pool.utilisation(),
        ymusd.totalSupply(),
        pool.netAssetValue(),
        pool.withdrawalFeeBps(),
        pool.depositLockSeconds(),
        pool.minPoolExpiry(),
        pool.maxStrikeDistanceBps(),
        pool.maxUtilisationBps(),
        pool.maxOptionExposureBps(),
        pool.cbUntil(),
        pool.openPoolOptionCount(),
      ]);
      if (get().network !== network) return; // switched network meanwhile
      // Share value is the net asset value (assets minus what open options may owe), the price shares trade at
      const shareValue = supply > 0n
        ? parseFloat(ethers.formatEther(nav * ethers.parseEther('1') / supply)).toFixed(4)
        : '1.0000';
      set({
        poolTotalAssets: parseFloat(ethers.formatEther(total)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolLocked:      parseFloat(ethers.formatEther(locked)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolUtilisation: (parseFloat(ethers.formatEther(util)) * 100).toFixed(1),
        poolShareValue:  shareValue,
        poolParams: {
          withdrawalFeeBps: Number(feeBps), depositLockSeconds: Number(lockSecs), minPoolExpiry: Number(minExp),
          strikeDistanceBps: Number(strikeBps), maxUtilisationBps: Number(utilMax), maxOptionExposureBps: Number(expMax),
          cbUntil: Number(cbUntil), openPoolOptions: Number(openN),
          utilisationBps: Math.round(parseFloat(ethers.formatEther(util)) * 10000),
        },
      });
    } catch {}
  },

  fetchOptions: async () => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net)) { set({ options: [], ordersLoading: false }); return; }
    const pool  = new ethers.Contract(net.addresses.pool, OptionPoolABI.abi, roProvider(network));
    set({ ordersLoading: true });
    try {
      const total = Number(await pool.nextId());
      const options = [];
      for (let i = 1; i < total; i++) {
        try {
          const o = await pool.getOption(i);
          options.push({
            id:          o.id,
            optionType:  o.optionType,   // 0=CALL 1=PUT
            status:      o.status,       // 0=OPEN 1=FILLED 2=SETTLED 3=REFUNDED
            long:        o.long,
            short:       o.short,
            filledByPool: o.filledByPool,
            marginType:  o.marginType,
            strike:      o.strike,
            premium:     o.premium,
            quantity:    o.quantity,
            expiry:      o.expiry,
            collateral:  o.collateral,
          });
        } catch {}
      }
      if (get().network === network) set({ options }); // ignore if the user switched network meanwhile
    } catch {}
    finally { if (get().network === network) set({ ordersLoading: false }); }
  },

  fetchAll: () => {
    get().fetchPrice();
    get().fetchBalances();
    get().fetchOptions();
    get().fetchPoolStats();
  },
}));
