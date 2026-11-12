import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
// Each page loads only its own code: the landing page doesn't pull in the trading terminal or the wallet layer.
// Pages that use a wallet load it with them (Mezo Passport + RainbowKit are large: Bitcoin-wallet libraries).
const withWallet = load => lazy(() => Promise.all([import('./WalletProviders'), load()]).then(([w, page]) => {
  const Wallet = w.default, Page = page.default;
  return { default: props => <Wallet><Page {...props} /></Wallet> };
}));
const Dashboard = withWallet(() => import('./Dashboard'));
const Home      = lazy(() => import('./home'));
const Stats     = withWallet(() => import('./Stats'));

import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="flex items-center justify-center h-screen bg-bg text-dim text-xs">Loading…</div>}>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/dashboard' element={<Dashboard />} />
        <Route path='/stats' element={<Stats />} />
        {/* Unknown paths (incl. the retired /faucet page) go home; the faucet is linked from there on testnet. */}
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
