import { create } from 'zustand';
import { ethers } from 'ethers';
import CallOptionABI from './contracts/CallOption.json';
import PutOptionABI  from './contracts/PutOption.json';
import MUSDABI       from './abi/musd.json';

const CONTRACT_ADDRESSES = {
  31611: {
    call: '0x278269C888E18D73c315Df8BDE54711905637516',
    put:  '0x58579360e86BD2f489578b410C5284757EE517Ca',
    musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  },
};

export const useStore = create((set, get) => ({
  // wallet
  provider:  null,
  signer:    null,
  account:   null,
  chainId:   null,

  // contracts
  callContract: null,
  putContract:  null,
  musdContract: null,

  // market
  btcPrice: 0,

  // order book
  callOrders: [],
  putOrders:  [],
  ordersLoading: false,

  // balances
  btcBalance:  '—',
  musdBalance: '—',

  // refresh trigger
  tick: 0,
  refresh: () => set(s => ({ tick: s.tick + 1 })),

  // ── init from wagmi signer ──────────────────────────────────────────────
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

  // ── market price ────────────────────────────────────────────────────────
  fetchPrice: async () => {
    const { callContract } = get();
    try {
      if (callContract) {
        const raw = await callContract.getMarketValue();
        set({ btcPrice: parseFloat(ethers.formatUnits(raw, 18)) });
        return;
      }
    } catch {}
    try {
      const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
      set({ btcPrice: parseFloat(price) });
    } catch {}
  },

  // ── balances ─────────────────────────────────────────────────────────────
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

  // ── orders ───────────────────────────────────────────────────────────────
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

  // ── fetch everything ─────────────────────────────────────────────────────
  fetchAll: () => {
    get().fetchPrice();
    get().fetchBalances();
    get().fetchOrders();
  },
}));
