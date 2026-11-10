import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { NETWORKS } from './network.mjs';

// Both Mezo networks are known to the wallet layer; which one the app uses is the user's choice
// (store.network). Trading is enabled only where Piton is deployed (see isLive in network.mjs).
export const mezoMatsnet = NETWORKS.testnet.chain;
export const mezoMainnet = NETWORKS.mainnet.chain;

export const wagmiConfig = createConfig({
  chains: [mezoMatsnet, mezoMainnet],
  connectors: [injected()],
  transports: {
    [mezoMatsnet.id]: http(mezoMatsnet.rpcUrls.default.http[0]),
    [mezoMainnet.id]: http(mezoMainnet.rpcUrls.default.http[0]),
  },
});
