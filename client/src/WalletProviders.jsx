import './polyfills'; // must stay first: Node globals for the Bitcoin-wallet libraries
import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { useStore } from './store';
import { buildWagmiConfig } from './wagmi';

const queryClient = new QueryClient();

// RainbowKit in Piton's colours (client/tailwind.config.js)
const theme = darkTheme({ accentColor: '#00ff88', accentColorForeground: '#04130b', borderRadius: 'small', overlayBlur: 'small' });
theme.colors.modalBackground = '#0b0e0b';
theme.colors.modalBorder = '#1e2a1e';
theme.fonts.body = '"DM Sans", system-ui, sans-serif';

/**
 * Wallet layer, one config per Mezo network. Switching network in the app rebuilds the wallet config (the
 * providers are keyed by network) and reconnects; the rest of the app state lives in the store and is kept.
 */
export default function WalletProviders({ children }) {
  const network = useStore(s => s.network);
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider key={network} config={buildWagmiConfig(network)} reconnectOnMount>
        <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName: 'Piton', learnMoreUrl: 'https://piton.surge.sh/#testing' }}>
          {children}
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
