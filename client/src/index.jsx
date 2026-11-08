import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { wagmiConfig } from './wagmi';
import App from './App';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <App />
      <ToastContainer position="bottom-right" theme="dark" autoClose={4000} />
    </QueryClientProvider>
  </WagmiProvider>
);
