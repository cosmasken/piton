import { create } from 'zustand';
import { ethers } from 'ethers';
import OptionPoolABI from './contracts/OptionPool.json';
import yMUSD_ABI    from './contracts/yMUSD.json';
import MUSDABI      from './abi/musd.json';
import { instrumentId, parseInstrumentId } from './instruments.mjs';
import { multicall, MULTICALL3, MC_IFACE } from './multicall';
import { toast } from 'react-toastify';
import { NETWORKS, DEFAULT_NETWORK, NETWORK_STORAGE_KEY, getNetwork, isLive, networkByChainId, resolveInitialNetwork } from './network.mjs';
import { PassportSigner, isBitcoinWalletClient } from './walletSigner.mjs';

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

const ORACLE_IFACE = new ethers.Interface(SKIP_ORACLE_ABI);
const POOL_IFACE   = new ethers.Interface(OptionPoolABI.abi);
const YMUSD_IFACE  = new ethers.Interface(yMUSD_ABI.abi); // ERC20 reads (also used for MUSD balanceOf)
// Pool view functions read every block (names are the contract's own)
const POOL_FIELDS = ['totalAssets', 'lockedCollateral', 'utilisation', 'netAssetValue', 'withdrawalFeeBps', 'depositLockSeconds',
  'minPoolExpiry', 'maxStrikeDistanceBps', 'maxUtilisationBps', 'maxOptionExposureBps', 'cbUntil', 'openPoolOptionCount', 'iv', 'askIv',
  'totalPremiumsEarned', 'totalSettlementsPaid', 'totalPerformanceFeePaid', 'unrecognizedPremium', 'maxOptionCollateral',
  'cbRefPrice', 'cbRefTime', 'cbWindow', 'cbMaxMoveBps',
  'invested', 'investCapBps', 'totalSavingsYield']; // savings fields read as null on pools without the module

// Must match OptionPool.PRICE_STALENESS: the contract rejects oracle prices older than this for trades and deposits.
export const PRICE_STALENESS_S = 30;
// (Exercise accepts prices up to 120 s old — OptionPool.EXERCISE_PRICE_STALENESS — so exercise is not gated on this.)

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

// Read-only "watch" mode: ?watch=0x... shows that address's account, positions and history without a wallet.
// Nothing can be signed in this mode (no signer), so it is safe to share.
const watchAddress = (() => {
  try { const a = new URLSearchParams(window.location.search).get('watch'); return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? ethers.getAddress(a) : null; }
  catch { return null; }
})();

const SETTINGS_KEY = 'piton_settings';
// Defaults for the trade form, sell-back and the option chain (Settings in the top bar)
// defaultSize '' = the network's default (network.mjs: 0.001 BTC on testnet, 0.01 on mainnet)
export const DEFAULT_SETTINGS = { defaultSize: '', slippagePct: 2, priceUnit: 'musd', notify: false, alertMinutes: 60, utc: false };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}

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
    set({ network: key, btcPrice: 0, oracleStale: false, priceSource: 'oracle', block: null, trades: [], chain: null });
    // the dashboard restarts the live engine and reloads options when the network changes
  },

  provider:     null,
  signer:       null,
  account:      watchAddress,
  watching:     !!watchAddress,
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
  // Enter in the option chain asks the trade form to open its review dialog
  reviewTick: 0,
  requestReview: () => set(s => ({ reviewTick: s.reviewTick + 1 })),
  // The order currently in the trade form ({ side, isCall, strike, qty, premium, collateral }) for chart overlays
  tradeLeg: null,
  setTradeLeg: leg => set({ tradeLeg: leg }),
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
    // Mezo Passport Bitcoin wallets (Unisat, OKX, Xverse) send through their Mezo smart account; their transport
    // has no accounts, so they get the PassportSigner and a read-only provider. EVM wallets work as before.
    const bitcoinWallet = isBitcoinWalletClient(walletClient);
    const provider = bitcoinWallet ? roProvider(net.key) : new ethers.BrowserProvider(walletClient.transport);
    const signerP = bitcoinWallet ? Promise.resolve(new PassportSigner(walletClient, provider)) : provider.getSigner();
    signerP.then(signer => {
      if (get().network !== net.key) return; // user switched network while the wallet was connecting
      const poolContract  = new ethers.Contract(addrs.pool,  OptionPoolABI.abi, signer);
      const ymusdContract = new ethers.Contract(addrs.ymusd, yMUSD_ABI.abi,    signer);
      const musdContract  = new ethers.Contract(addrs.musd,  MUSDABI.abi,      signer);
      set({ provider, signer, account: walletClient.account.address, chainId, bitcoinWallet,
            poolContract, ymusdContract, musdContract });
      get().fetchAll();
    });
  },

  reset: () => set({
    provider: null, signer: null, account: watchAddress, chainId: null, bitcoinWallet: false,
    poolContract: null, ymusdContract: null, musdContract: null,
    options: [], btcBalance: '—', musdBalance: '—', ymusdBalance: '—', musdRaw: '0', ymusdRaw: '0', lockExpiry: 0, history: null, autoEx: {},
    ...EMPTY_POOL_STATS,
  }),

  /**
   * Everything that changes block by block, in one Multicall3 request: oracle price, block number and time,
   * all pool stats, and (when a wallet is connected) its balances and deposit lock.
   * fetchPrice / fetchBalances / fetchPoolStats are kept as names for existing callers.
   */
  refreshState: async () => {
    const { network, account } = get();
    const net = getNetwork(network);
    const provider = roProvider(network);
    const live = isLive(net);
    const a = net.addresses;
    const keys = [], calls = [];
    const add = (key, target, iface, fn, args = []) => { keys.push(key); calls.push({ target, iface, fn, args }); };
    add('block', MULTICALL3, MC_IFACE, 'getBlockNumber');
    add('blockTime', MULTICALL3, MC_IFACE, 'getCurrentBlockTimestamp');
    add('oracle', a.oracle, ORACLE_IFACE, 'latestRoundData');
    add('dec', a.oracle, ORACLE_IFACE, 'decimals');
    if (live) {
      for (const f of POOL_FIELDS) add(f, a.pool, POOL_IFACE, f);
      add('supply', a.ymusd, YMUSD_IFACE, 'totalSupply');
      if (account) {
        add('btc', MULTICALL3, MC_IFACE, 'getEthBalance', [account]);
        add('musd', a.musd, YMUSD_IFACE, 'balanceOf', [account]);
        add('ymusd', a.ymusd, YMUSD_IFACE, 'balanceOf', [account]);
        add('lock', a.pool, POOL_IFACE, 'depositLockExpiry', [account]);
      }
    }
    let r;
    try {
      const res = await multicall(provider, calls);
      r = Object.fromEntries(keys.map((k, i) => [k, res[i]]));
    } catch { return; }
    if (get().network !== network) return; // switched network meanwhile
    const E = v => (v == null ? null : parseFloat(ethers.formatEther(v)));
    const patch = {};
    if (r.block != null) patch.block = { number: Number(r.block), time: Number(r.blockTime || 0), seenAt: Date.now() };

    // Skip oracle: the settlement price. Older than PRICE_STALENESS_S means the contract would reject trades.
    if (r.oracle && r.dec != null) {
      const price = parseFloat(ethers.formatUnits(r.oracle[1], r.dec));
      // age against the block's own timestamp (what the contract uses), not the browser clock, which can drift
      const nowS = Number(r.blockTime) || Math.floor(Date.now() / 1000);
      const age = nowS - Number(r.oracle[3]);
      if (age <= PRICE_STALENESS_S && price > 0) {
        const prev = get().btcPrice;
        Object.assign(patch, { btcPrice: price, oracleStale: false, priceSource: 'oracle', priceDir: prev && price !== prev ? (price > prev ? 'up' : 'down') : get().priceDir });
      } else {
        patch.oracleStale = true;
        const last = get().lastPrice; // fall back to the exchange price for display only
        if (last) Object.assign(patch, { btcPrice: last, priceSource: 'binance' });
      }
    }

    if (live && r.totalAssets != null) {
      const supply = r.supply ?? 0n;
      const shareValue = supply > 0n && r.netAssetValue != null
        ? parseFloat(ethers.formatEther(r.netAssetValue * ethers.parseEther('1') / supply)).toFixed(4) : '1.0000';
      Object.assign(patch, {
        poolTotalAssets: E(r.totalAssets).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolLocked:      E(r.lockedCollateral).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolUtilisation: (E(r.utilisation) * 100).toFixed(1),
        poolShareValue:  shareValue,
        poolParams: {
          withdrawalFeeBps: Number(r.withdrawalFeeBps), depositLockSeconds: Number(r.depositLockSeconds), minPoolExpiry: Number(r.minPoolExpiry),
          strikeDistanceBps: Number(r.maxStrikeDistanceBps), maxUtilisationBps: Number(r.maxUtilisationBps), maxOptionExposureBps: Number(r.maxOptionExposureBps),
          cbUntil: Number(r.cbUntil), openPoolOptions: Number(r.openPoolOptionCount),
          totalAssets: E(r.totalAssets), lockedCollateral: E(r.lockedCollateral),
          cbRefPrice: E(r.cbRefPrice), cbRefTime: Number(r.cbRefTime), cbWindow: Number(r.cbWindow), cbMaxMoveBps: Number(r.cbMaxMoveBps),
          maxOptionCollateral: E(r.maxOptionCollateral),
          iv: E(r.iv), askIv: E(r.askIv),
          premiumsEarned: E(r.totalPremiumsEarned), settlementsPaid: E(r.totalSettlementsPaid),
          performanceFeesPaid: E(r.totalPerformanceFeePaid), unearnedPremium: E(r.unrecognizedPremium),
          utilisationBps: Math.round(E(r.utilisation) * 10000),
          // idle MUSD in Mezo's MUSD Savings Rate (null when the pool has no savings module)
          invested: E(r.invested), investCapBps: r.investCapBps != null ? Number(r.investCapBps) : null, savingsYield: E(r.totalSavingsYield),
        },
      });
    } else if (!live) Object.assign(patch, EMPTY_POOL_STATS);

    if (live && account && r.musd != null) {
      Object.assign(patch, {
        lockExpiry:   Number(r.lock ?? 0),
        musdRaw:      ethers.formatEther(r.musd),
        ymusdRaw:     ethers.formatEther(r.ymusd ?? 0n),
        btcBalance:   r.btc != null ? E(r.btc).toFixed(4) : get().btcBalance,
        musdBalance:  E(r.musd).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        ymusdBalance: E(r.ymusd ?? 0n).toLocaleString('en-US', { maximumFractionDigits: 2 }),
      });
    }
    set(patch);
  },

  fetchPrice:     () => get().refreshState(),
  fetchBalances:  () => get().refreshState(),
  fetchPoolStats: () => get().refreshState(),

  fetchOptions: async () => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net)) { set({ options: [], ordersLoading: false }); return; }
    const provider = roProvider(network);
    set({ ordersLoading: true });
    try {
      const pool = new ethers.Contract(net.addresses.pool, OptionPoolABI.abi, provider);
      const total = Number(await pool.nextId());
      const ids = Array.from({ length: Math.max(0, total - 1) }, (_, i) => BigInt(i + 1));
      const options = await get().loadOptions(ids);
      if (get().network === network) set({ options }); // ignore if the user switched network meanwhile
    } catch {}
    finally { if (get().network === network) set({ ordersLoading: false }); }
  },

  /** Read options by id in batched multicalls; returns plain objects (BigInt fields, as the contract returns). */
  loadOptions: async (ids) => {
    if (!ids.length) return [];
    const net = getNetwork(get().network);
    const res = await multicall(roProvider(get().network), ids.map(id => ({ target: net.addresses.pool, iface: POOL_IFACE, fn: 'getOption', args: [id] })));
    return res.filter(Boolean).map(o => ({
      id: o.id, optionType: o.optionType, status: o.status, long: o.long, short: o.short, filledByPool: o.filledByPool,
      marginType: o.marginType, strike: o.strike, premium: o.premium, quantity: o.quantity, expiry: o.expiry, collateral: o.collateral,
    }));
  },

  // ─── wallet history (subgraph), auto-exercise flags, settings ──────────────
  // history: { account: { deposited, withdrawn, ... } | null, activities: [...], ended: [...options], at } or null
  history: null,
  historyLoading: false,
  fetchHistory: async () => {
    const me = get().account?.toLowerCase();
    if (!me) { set({ history: null }); return; }
    set({ historyLoading: true });
    const opt = 'id optionType strike quantity premium payout status expiry short long { id }';
    const d = await get().querySubgraph(`{
      account(id: "${me}") { deposited withdrawn premiumPaid payoutsReceived tradeCount }
      activities(first: 500, orderBy: timestamp, orderDirection: desc, where: { account: "${me}" }) {
        id kind amount shares timestamp tx option { ${opt} } }
      asLong: options(first: 1000, where: { long: "${me}" }) { ${opt} }
      asShort: options(first: 1000, where: { short: "${me}" }) { ${opt} }
    }`);
    if (get().account?.toLowerCase() !== me) return;
    set({ historyLoading: false, history: d ? {
      account: d.account, activities: d.activities || [], ended: [...(d.asLong || []), ...(d.asShort || [])], at: Date.now(),
    } : null });
  },

  // option id (string) -> auto-exercise on, for the wallet's live long positions
  autoEx: {},
  fetchAutoEx: async () => {
    const me = get().account?.toLowerCase();
    const net = getNetwork(get().network);
    if (!me || !isLive(net)) { set({ autoEx: {} }); return; }
    const now = Math.floor(Date.now() / 1000);
    const ids = get().options.filter(o => Number(o.status) === 1 && Number(o.expiry) > now && o.long?.toLowerCase() === me).map(o => o.id);
    if (!ids.length) { set({ autoEx: {} }); return; }
    try {
      const r = await multicall(roProvider(get().network), ids.map(id => ({ target: net.addresses.pool, iface: POOL_IFACE, fn: 'autoExercise', args: [id] })));
      set({ autoEx: Object.fromEntries(ids.map((id, i) => [String(id), !!r[i]])) });
    } catch { /* keep the old map */ }
  },

  settings: loadSettings(),
  setSettings: patch => {
    const settings = { ...get().settings, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
    set({ settings });
  },

  // ─── live updates ─────────────────────────────────────────────────────────
  // block: latest block seen ({ number, time, seenAt }); lastPrice: exchange "last" (Binance), ticking every second.
  block: null,
  lastPrice: 0,
  lastDir: null,
  priceDir: null,
  _live: null,

  /**
   * Watch for new blocks (every 2s while the tab is visible, 30s when hidden). On each new block: one
   * multicall for prices, pool stats and balances, then the pool's event logs since the last block, which
   * update only the options they touch. Also streams Binance's BTCUSDT ticker for the "last" price.
   */
  startLive: () => {
    get().stopLive();
    const network = get().network;
    let stopped = false, timer = null, lastBlock = 0, logFrom = null, ws = null, wsRetry = null;
    const visible = () => typeof document === 'undefined' || !document.hidden;

    const tick = async () => {
      if (stopped) return;
      try {
        const n = await roProvider(network).getBlockNumber();
        if (n !== lastBlock) {
          lastBlock = n;
          await get().refreshState();
          if (logFrom == null) logFrom = n + 1;                       // first block: the full load covers history
          else if (n - logFrom > 8000) { logFrom = n + 1; get().fetchOptions(); get().fetchTrades(); } // long gap: reload
          else if (n >= logFrom) { await get().processLogs(logFrom, n); logFrom = n + 1; }
        }
      } catch { /* try again next tick */ }
      if (!stopped) timer = setTimeout(tick, visible() ? 2000 : 30000);
    };

    const openTicker = () => {
      if (stopped || ws || !visible()) return;
      try { ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@miniTicker'); } catch { return; }
      ws.onmessage = ev => {
        try {
          const m = JSON.parse(ev.data);
          const c = parseFloat(m.c), o = parseFloat(m.o);
          if (!(c > 0)) return;
          const prev = get().lastPrice;
          set({
            lastPrice: c, lastDir: prev && c !== prev ? (c > prev ? 'up' : 'down') : get().lastDir,
            market: { ...(get().market || {}), change24hPct: o > 0 ? (c - o) / o * 100 : null, high24h: parseFloat(m.h), low24h: parseFloat(m.l) },
          });
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => { ws = null; if (!stopped) wsRetry = setTimeout(openTicker, 5000); };
    };
    const closeTicker = () => { clearTimeout(wsRetry); if (ws) { ws.onclose = null; ws.close(); ws = null; } };

    const onVisibility = () => {
      if (visible()) { clearTimeout(timer); tick(); openTicker(); }   // back in view: refresh at once
      else closeTicker();                                            // hidden: no ticker, slow block polling
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    tick(); openTicker();
    set({ _live: { stop: () => {
      stopped = true; clearTimeout(timer); closeTicker();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    } } });
  },

  stopLive: () => { get()._live?.stop(); set({ _live: null }); },

  /** Apply pool events from blocks [from, to]: refresh touched options, add new trades, and announce others' fills. */
  processLogs: async (from, to) => {
    const network = get().network;
    const net = getNetwork(network);
    if (!isLive(net)) return;
    const provider = roProvider(network);
    const logs = await provider.getLogs({ address: net.addresses.pool, fromBlock: from, toBlock: to });
    if (!logs.length || get().network !== network) return;
    const touched = new Set(), fills = [];
    for (const l of logs) {
      let ev; try { ev = POOL_IFACE.parseLog(l); } catch { continue; }
      if (!ev) continue;
      if (['OrderCreated', 'OrderFilled', 'Settled', 'Refunded', 'Cancelled', 'SoldBack', 'AutoExerciseSet'].includes(ev.name)) touched.add(ev.args[0]);
      if (ev.name === 'OrderFilled') fills.push({ id: ev.args[0], filler: ev.args[1], byPool: ev.args[2], tx: l.transactionHash, block: l.blockNumber });
    }
    if (touched.size) {
      const fresh = await get().loadOptions([...touched]);
      if (get().network !== network) return;
      const byId = new Map(get().options.map(o => [String(o.id), o]));
      for (const o of fresh) byId.set(String(o.id), o);
      set({ options: [...byId.values()].sort((x, y) => Number(x.id - y.id)) });
    }
    // the wallet's own activity changed: refresh its history and auto-exercise flags
    const me = get().account?.toLowerCase();
    if (me && touched.size) {
      const mine = get().options.some(o => touched.has(o.id) && (o.long?.toLowerCase() === me || o.short?.toLowerCase() === me));
      if (mine) { get().fetchAutoEx(); setTimeout(() => get().fetchHistory(), 8000); } // give the subgraph a few seconds to index
    }
    if (fills.length) {
      const blockTime = get().block?.time || Math.floor(Date.now() / 1000);
      const added = fills.map(f => ({ ...f, time: blockTime, live: Date.now() }));
      set({ trades: [...added.reverse(), ...get().trades].slice(0, 500) });
      const me = get().account?.toLowerCase();
      for (const f of fills) {
        const o = get().options.find(x => String(x.id) === String(f.id));
        if (!o || o.long?.toLowerCase() === me || o.short?.toLowerCase() === me) continue; // your own trades already toast
        const q = parseFloat(ethers.formatEther(o.quantity)), k = Math.round(parseFloat(ethers.formatEther(o.strike)));
        toast.info(`${f.byPool ? 'Pool sold' : 'Trade:'} ${q} BTC ${k.toLocaleString()} ${Number(o.optionType) === 0 ? 'call' : 'put'} for ${parseFloat(ethers.formatEther(o.premium)).toFixed(2)} MUSD`, { autoClose: 4000 });
      }
    }
  },

  /** Pool ask price per BTC for every strike of one expiry (calls and puts), read from the contract's own quote. */
  fetchChain: async (expiry, strikes) => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net) || !expiry || !strikes?.length) return;
    const REF = ethers.parseEther('0.01'); // small reference size; bigger orders cost more (utilisation markup)
    const cells = strikes.flatMap(k => [true, false].map(isCall => ({ k, isCall })));
    let res;
    try {
      res = await multicall(roProvider(network), cells.map(c => ({
        target: net.addresses.pool, iface: POOL_IFACE, fn: 'quotePremium', args: [c.isCall, ethers.parseEther(String(c.k)), REF, expiry],
      })), 8); // each quote runs Black-Scholes on-chain (~83k gas): small chunks stay under the RPC's per-call gas cap
    } catch { return; }
    if (get().network !== network) return;
    const prev = get().chain && get().chain.expiry === expiry ? get().chain.byStrike : {};
    const byStrike = {};
    cells.forEach((c, i) => {
      const cell = (byStrike[c.k] ||= {});
      cell[c.isCall ? 'call' : 'put'] = res[i] != null ? parseFloat(ethers.formatEther(res[i])) * 100 : null;
      // remember the previous price so the chain can flash the change
      cell[c.isCall ? 'callPrev' : 'putPrev'] = prev[c.k]?.[c.isCall ? 'call' : 'put'] ?? null;
    });
    set({ chain: { expiry, at: Date.now(), byStrike } });
  },

  /**
   * Recent fills, from the subgraph when configured. Fallback: OrderFilled events over the last ~26 hours (enough for 24h volume and the trades tab).
   * Scanned in 9,000-block chunks (the RPC rejects bigger ranges). Times are estimated from the block
   * number using the measured block time, which is accurate to seconds on Mezo's regular blocks.
   */
  fetchTrades: async () => {
    const { network } = get();
    const net = getNetwork(network);
    if (!isLive(net)) { set({ trades: [] }); return; }
    // Preferred: the subgraph (full history, one request). Falls back to scanning chain logs if it is down.
    if (net.subgraph) {
      try {
        const res = await fetch(net.subgraph, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: '{ trades(first: 500, orderBy: timestamp, orderDirection: desc) { id option { id } buyer { id } byPool timestamp tx } }' }),
        });
        const j = await res.json();
        if (j?.data?.trades && get().network === network) {
          set({ trades: j.data.trades.map(t => ({
            id: BigInt(t.option.id), filler: t.buyer.id, byPool: t.byPool, time: Number(t.timestamp), tx: t.tx,
          })) });
          return;
        }
      } catch { /* fall through to the chain scan */ }
    }
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

  /** Run a GraphQL query against the selected network's subgraph; returns `data` or null. */
  querySubgraph: async (query) => {
    const net = getNetwork(get().network);
    if (!net.subgraph) return null;
    try {
      const r = await fetch(net.subgraph, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      const j = await r.json();
      return j?.data || null;
    } catch { return null; }
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
    get().refreshState();
    get().fetchOptions();
    get().fetchTrades();
  },
}));
