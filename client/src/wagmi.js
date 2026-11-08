import { http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  getUnisatWallet,
  getXverseWallet,
  getOKXWallet,
} from '@mezo-org/passport';

export const mezoMatsnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.test.mezo.org' } },
};

const btcWalletConfig = { rpcUrl: 'https://rpc.test.mezo.org', chainId: 31611 };

export const wagmiConfig = getDefaultConfig({
  appName: 'Piton',
  projectId: 'piton-placeholder', // WalletConnect project ID — replace for production
  chains: [mezoMatsnet],
  transports: { [mezoMatsnet.id]: http() },
  wallets: [
    {
      groupName: 'Bitcoin Wallets',
      wallets: [
        getUnisatWallet(btcWalletConfig),
        getXverseWallet(btcWalletConfig),
        getOKXWallet(btcWalletConfig),
      ],
    },
    {
      groupName: 'EVM Wallets',
      wallets: [injected],
    },
  ],
  ssr: false,
});
