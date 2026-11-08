import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

export const mezoMatsnet = {
  id: 31611,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.test.mezo.org' } },
};

export const wagmiConfig = createConfig({
  chains: [mezoMatsnet],
  connectors: [injected()],
  transports: { [mezoMatsnet.id]: http() },
});
