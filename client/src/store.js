import { create } from 'zustand';
import { ethers } from 'ethers';
import OptionPoolABI from './contracts/OptionPool.json';
import yMUSD_ABI    from './contracts/yMUSD.json';
import MUSDABI      from './abi/musd.json';
import { instrumentId, parseInstrumentId } from './instruments.mjs';
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

// status enum from contract (0=OPEN 1=FILLED 2=SETTLED 3=REFUNDED 4=CLOSED)
export const STATUS = { OPEN: 0n, FILLED: 1n, SETTLED: 2n, REFUNDED: 3n, CLOSED: 4n }; // CLOSED = sold back to the pool
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
  musdRaw:      '0',   // exact balances (ether units, full precision) for Max buttons and checks
  ymusdRaw:     '0',

  // pool stats
  poolTotalAssets:    '—',
  poolLocked:         '—',
  poolUtilisation:    '—',
  poolShareValue:     '—',
  // live rules read from the contract (fees, limits, breaker); null until loaded
  poolParams:         null,
  lockExpiry:         0,   // connected account's deposit lock (unix seconds)

  // Instrument chosen in the option chain (drives the order form and book). Shareable via ?i=C-75000-<expiry>
  selected: null,
  setSelected: (sel) => {
    set({ selected: sel });
    try {
      const u = new URL(window.location.href);
      if (sel) u.searchParams.set('i', instrumentId(sel)); else u.searchParams.delete('i');
      window.history.replaceState(null, '', u);
    } catch { /* non-browser */ }
  },

  // Pool ask prices per 1 BTC (small reference size) for the selected expiry: { expiry, at, byStrike: { [strike]: { call, put } } }
  chain: null,
  trades: [],
  // 24h market data from outside the chain: { change24hPct, high24h, low24h, dvol, at }
  market: null,

  /** Read-only pool contract for the selected network (works without a wallet), or null when not live. */
  roPool: () => {
    const { network } = get();
    const net = getNetwork(network);
    return isLive(net) ? new ethers.Contract(net.addresses.pool, OptionPoolABI.abi, roProvider(network)) : null;
  },

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
    options: [], btcBalance: '—', musdBalance: '—', ymusdBalance: '—', musdRaw: '0', ymusdRaw: '0', lockExpiry: 0,
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
        musdRaw:      ethers.formatEther(m),
        ymusdRaw:     ethers.formatEther(y),
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
      const [total, locked, util, supply, nav, feeBps, lockSecs, minExp, strikeBps, utilMax, expMax, cbUntil, openN, ivMid, ivAsk, premEarned, settlePaid, perfPaid, unrecog, maxColl] = await Promise.all([
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
        pool.iv(),
        pool.askIv(),
        pool.totalPremiumsEarned(),
        pool.totalSettlementsPaid(),
        pool.totalPerformanceFeePaid(),
        pool.unrecognizedPremium(),
        pool.maxOptionCollateral(),
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
          totalAssets: parseFloat(ethers.formatEther(total)), lockedCollateral: parseFloat(ethers.formatEther(locked)), maxOptionCollateral: parseFloat(ethers.formatEther(maxColl)),
          iv: parseFloat(ethers.formatEther(ivMid)), askIv: parseFloat(ethers.formatEther(ivAsk)),
          premiumsEarned: parseFloat(ethers.formatEther(premEarned)), settlementsPaid: parseFloat(ethers.formatEther(settlePaid)),
          performanceFeesPaid: parseFloat(ethers.formatEther(perfPaid)), unearnedPremium: parseFloat(ethers.formatEther(unrecog)),
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

  /** Pool ask price per BTC for every strike of one expiry (calls and puts), read from the contract's own quote. */
  fetchChain: async (expiry, strikes) => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net) || !expiry || !strikes?.length) return;
    const pool = new ethers.Contract(net.addresses.pool, OptionPoolABI.abi, roProvider(network));
    const REF = ethers.parseEther('0.01'); // small reference size; bigger orders cost more (utilisation markup)
    const cells = strikes.flatMap(k => [true, false].map(isCall => ({ k, isCall })));
    const res = await Promise.allSettled(cells.map(c => pool.quotePremium(c.isCall, ethers.parseEther(String(c.k)), REF, expiry)));
    if (get().network !== network) return;
    const byStrike = {};
    cells.forEach((c, i) => {
      const cell = (byStrike[c.k] ||= {});
      cell[c.isCall ? 'call' : 'put'] = res[i].status === 'fulfilled' ? parseFloat(ethers.formatEther(res[i].value)) * 100 : null;
    });
    set({ chain: { expiry, at: Date.now(), byStrike } });
  },

  /**
   * Fills from OrderFilled events over the last ~26 hours (enough for 24h volume and the trades tab).
   * Scanned in 9,000-block chunks (the RPC rejects bigger ranges). Times are estimated from the block
   * number using the measured block time, which is accurate to seconds on Mezo's regular blocks.
   */
  fetchTrades: async () => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net)) { set({ trades: [] }); return; }
    const provider = roProvider(network);
    const pool = new ethers.Contract(net.addresses.pool, OptionPoolABI.abi, provider);
    try {
      const headBlock = await provider.getBlock('latest');
      const head = headBlock.number;
      const ref = await provider.getBlock(Math.max(0, head - 5000));
      const secPerBlock = ref && head > ref.number ? (headBlock.timestamp - ref.timestamp) / (head - ref.number) : 4;
      const span = Math.ceil(26 * 3600 / Math.max(0.5, secPerBlock));
      const floor = Math.max(net.addresses.deployBlock || 0, head - span);
      const logs = [];
      for (let to = head; to >= floor; to -= 9000) {
        const from = Math.max(floor, to - 8999);
        logs.push(...await pool.queryFilter(pool.filters.OrderFilled(), from, to));
      }
      logs.sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index);
      if (get().network !== network) return;
      set({ trades: logs.slice(0, 500).map(l => ({
        id: l.args[0], filler: l.args[1], byPool: l.args[2], tx: l.transactionHash,
        time: Math.round(headBlock.timestamp - (head - l.blockNumber) * secPerBlock),
      })) });
    } catch { /* history is a nice-to-have */ }
  },

  /** BTC 24h change/high/low (Binance) and Deribit's BTC volatility index (DVOL), for the market header. */
  fetchMarket: async () => {
    const out = { ...(get().market || {}), at: Date.now() };
    try {
      const t = await (await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT')).json();
      out.change24hPct = parseFloat(t.priceChangePercent); out.high24h = parseFloat(t.highPrice); out.low24h = parseFloat(t.lowPrice);
    } catch { /* optional */ }
    try {
      const end = Date.now();
      const j = await (await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${end - 6 * 3600e3}&end_timestamp=${end}&resolution=3600`)).json();
      const rows = j?.result?.data;
      if (rows?.length) out.dvol = Number(rows[rows.length - 1][4]) / 100;
    } catch { /* optional */ }
    set({ market: out });
  },

  fetchAll: () => {
    get().fetchPrice();
    get().fetchBalances();
    get().fetchOptions();
    get().fetchPoolStats();
    get().fetchTrades();
  },
}));
