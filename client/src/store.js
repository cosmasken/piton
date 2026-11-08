import { create } from 'zustand';
import { ethers } from 'ethers';
import CallOptionABI from './contracts/CallOption.json';
import PutOptionABI  from './contracts/PutOption.json';
import MUSDABI       from './abi/musd.json';

const CONTRACT_ADDRESSES = {
  31611: {
    call: '0xd24fbb05E888aD3F22bEC8323D6D164Ec49bDDb7',
    put:  '0x5c3b1e87668DEF8909500640099068CE20c78416',
    musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
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

const STALENESS_WARN = 90 * 60; // warn at 90 min (contract rejects at 120 min)

export const useStore = create((set, get) => ({
  provider:  null,
  signer:    null,
  account:   null,
  chainId:   null,

  callContract: null,
  putContract:  null,
  musdContract: null,

  btcPrice:    0,
  oracleStale: false,
  priceSource: 'oracle',

  simpleMode: false,
  setSimpleMode: (v) => set({ simpleMode: v }),

  callOrders:    [],
  putOrders:     [],
  ordersLoading: false,

  btcBalance:  '—',
  musdBalance: '—',

  tick: 0,
  refresh: () => set(s => ({ tick: s.tick + 1 })),

  init: (walletClient, chainId) => {
    if (!walletClient || !chainId) return;
    const addrs = CONTRACT_ADDRESSES[chainId];
    if (!addrs) return;
    const provider = new ethers.BrowserProvider(walletClient.transport);
    provider.getSigner().then(signer => {
      const callContract = new ethers.Contract(addrs.call, CallOptionABI.abi, signer);
      const putContract  = new ethers.Contract(addrs.put,  PutOptionABI.abi,  signer);
      const musdContract = new ethers.Contract(addrs.musd, MUSDABI.abi,       signer);
      set({ provider, signer, account: walletClient.account.address, chainId, callContract, putContract, musdContract });
      get().fetchAll();
    });
  },

  reset: () => set({
    provider: null, signer: null, account: null, chainId: null,
    callContract: null, putContract: null, musdContract: null,
    callOrders: [], putOrders: [], btcBalance: '—', musdBalance: '—',
  }),

  fetchPrice: async () => {
    const { provider } = get();
    // Try Skip oracle first — also check staleness
    if (provider) {
      try {
        const oracle = new ethers.Contract(SKIP_ORACLE_ADDR, SKIP_ORACLE_ABI, provider);
        const [, answer, , updatedAt] = await oracle.latestRoundData();
        const dec   = await oracle.decimals();
        const price = parseFloat(ethers.formatUnits(answer, dec));
        const age   = Math.floor(Date.now() / 1000) - Number(updatedAt);
        if (age > STALENESS_WARN) {
          // stale — fall through to Binance but flag it
          set({ oracleStale: true });
        } else {
          set({ btcPrice: price, oracleStale: false, priceSource: 'oracle' });
          return;
        }
      } catch {}
    }
    // Binance fallback
    try {
      const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
      set({ btcPrice: parseFloat(price), priceSource: 'binance' });
    } catch {}
  },

  fetchBalances: async () => {
    const { provider, account, musdContract } = get();
    if (!provider || !account || !musdContract) return;
    try {
      const [b, m] = await Promise.all([
        provider.getBalance(account),
        musdContract.balanceOf(account),
      ]);
      set({
        btcBalance:  parseFloat(ethers.formatEther(b)).toFixed(4),
        musdBalance: parseFloat(ethers.formatUnits(m, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
      });
    } catch {}
  },

  fetchOrders: async () => {
    const { callContract, putContract } = get();
    if (!callContract || !putContract) return;
    set({ ordersLoading: true });
    const load = async (contract) => {
      const total = await contract.uniqueId();
      const orders = [];
      for (let i = 1; i < Number(total); i++) {
        try { const o = await contract.idToOption(i); if (o.isAvailable) orders.push(o); } catch {}
      }
      return orders;
    };
    try {
      const [callOrders, putOrders] = await Promise.all([load(callContract), load(putContract)]);
      set({ callOrders, putOrders });
    } catch {}
    finally { set({ ordersLoading: false }); }
  },

  fetchAll: () => { get().fetchPrice(); get().fetchBalances(); get().fetchOrders(); },
}));
