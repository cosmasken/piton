import { create } from 'zustand';
import { ethers } from 'ethers';
import OptionPoolABI from './contracts/OptionPool.json';
import yMUSD_ABI    from './contracts/yMUSD.json';
import MUSDABI      from './abi/musd.json';

export const ADDRESSES = {
  31611: {
    pool:  '0x12f9aD9212A3eb5E0796e47124076F0e63A5a20a',
    ymusd: '0xeA342D5568C1981dfF35353c28D3Ac7f6C842177',
    musd:  '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  },
};

const SKIP_ORACLE_ADDR = '0x7b7c000000000000000000000000000000000015';
const SKIP_ORACLE_ABI  = [
  { name: 'latestRoundData', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [
      { name: 'roundId', type: 'uint80' }, { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ]},
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
];

const RO_PROVIDER = new ethers.JsonRpcProvider('https://rpc.test.mezo.org');

// status enum from contract
export const STATUS = { OPEN: 0n, FILLED: 1n, SETTLED: 2n, REFUNDED: 3n };
export const TYPE   = { CALL: 0n, PUT: 1n };

export const useStore = create((set, get) => ({
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

  tick: 0,
  refresh: () => set(s => ({ tick: s.tick + 1 })),

  init: (walletClient, chainId) => {
    if (!walletClient || !chainId) return;
    const addrs = ADDRESSES[chainId];
    if (!addrs) return;
    const provider = new ethers.BrowserProvider(walletClient.transport);
    provider.getSigner().then(signer => {
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
    options: [], btcBalance: '—', musdBalance: '—', ymusdBalance: '—',
    poolTotalAssets: '—', poolLocked: '—', poolUtilisation: '—', poolShareValue: '—',
  }),

  fetchPrice: async () => {
    const { provider } = get();
    if (provider) {
      try {
        const oracle = new ethers.Contract(SKIP_ORACLE_ADDR, SKIP_ORACLE_ABI, provider);
        const [, answer, , updatedAt] = await oracle.latestRoundData();
        const dec   = await oracle.decimals();
        const price = parseFloat(ethers.formatUnits(answer, dec));
        const age   = Math.floor(Date.now() / 1000) - Number(updatedAt);
        if (age <= 90 * 60) {
          set({ btcPrice: price, oracleStale: false, priceSource: 'oracle' });
          return;
        }
        set({ oracleStale: true });
      } catch {}
    }
    try {
      const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
      set({ btcPrice: parseFloat(price), priceSource: 'binance' });
    } catch {}
  },

  fetchBalances: async () => {
    const { provider, account, musdContract, ymusdContract } = get();
    if (!provider || !account || !musdContract) return;
    try {
      const [b, m, y] = await Promise.all([
        provider.getBalance(account),
        musdContract.balanceOf(account),
        ymusdContract ? ymusdContract.balanceOf(account) : Promise.resolve(0n),
      ]);
      set({
        btcBalance:   parseFloat(ethers.formatEther(b)).toFixed(4),
        musdBalance:  parseFloat(ethers.formatEther(m)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        ymusdBalance: parseFloat(ethers.formatEther(y)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
      });
    } catch {}
  },

  fetchPoolStats: async () => {
    const addrs = ADDRESSES[31611];
    const pool  = new ethers.Contract(addrs.pool,  OptionPoolABI.abi, RO_PROVIDER);
    const ymusd = new ethers.Contract(addrs.ymusd, yMUSD_ABI.abi,    RO_PROVIDER);
    try {
      const [total, locked, util, supply] = await Promise.all([
        pool.totalAssets(),
        pool.lockedCollateral(),
        pool.utilisation(),
        ymusd.totalSupply(),
      ]);
      const shareValue = supply > 0n
        ? parseFloat(ethers.formatEther(total * ethers.parseEther('1') / supply)).toFixed(4)
        : '1.0000';
      set({
        poolTotalAssets: parseFloat(ethers.formatEther(total)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolLocked:      parseFloat(ethers.formatEther(locked)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        poolUtilisation: (parseFloat(ethers.formatEther(util)) * 100).toFixed(1),
        poolShareValue:  shareValue,
      });
    } catch {}
  },

  fetchOptions: async () => {
    const addrs = ADDRESSES[31611];
    const pool  = new ethers.Contract(addrs.pool, OptionPoolABI.abi, RO_PROVIDER);
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
      set({ options });
    } catch {}
    finally { set({ ordersLoading: false }); }
  },

  fetchAll: () => {
    get().fetchPrice();
    get().fetchBalances();
    get().fetchOptions();
    get().fetchPoolStats();
  },
}));
