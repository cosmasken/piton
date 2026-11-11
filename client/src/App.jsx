import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
// Each page loads only its own code: the landing page doesn't pull in the trading terminal.
const Dashboard = lazy(() => import('./Dashboard'));
const Home      = lazy(() => import('./home'));
const Stats     = lazy(() => import('./Stats'));

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
