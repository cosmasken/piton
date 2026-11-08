import React, { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useStore } from './store';
import { mezoMatsnet } from './wagmi';

import Navbar      from './components/Navbar';
import MarketValue from './components/MarketValue';
import NewOrder    from './components/NewOrder';
import Graph       from './components/graph';
import OpenOrders  from './components/OpenOrders';
import Wallet      from './components/Wallet';
import YourOrders  from './components/YourOrders';

function OracleBanner() {
  const { oracleStale, priceSource } = useStore();
  if (!oracleStale && priceSource !== 'binance') return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-yellow-900/40 border-b border-yellow-700/40 text-yellow-400 text-xs font-body">
      <span>⚠</span>
      <span>Skip oracle price is stale — showing <strong>Binance fallback price</strong>. On-chain actions may revert until the oracle updates.</span>
    </div>
  );
}

function OnboardingCard({ onDismiss }) {
  return (
    <div className="mx-2 mt-2 panel px-5 py-4 shrink-0">
      <div className="flex items-start justify-between mb-3">
        <p className="font-display font-semibold text-sm text-text">Get started with Piton</p>
        <button onClick={onDismiss} className="text-dim text-xs hover:text-text transition-colors">Dismiss</button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {[
          ['1', 'Get test BTC', 'From the Mezo faucet', 'https://faucet.test.mezo.org'],
          ['2', 'Borrow MUSD',  'Against your test BTC', 'https://testnet.mezo.org'],
          ['3', 'Place an order', 'Use the New Order panel', null],
        ].map(([n, title, sub, href]) => (
          <div key={n} className="flex-1 bg-surface rounded-lg px-4 py-3 border border-border">
            <div className="text-xs text-accent font-mono mb-1">Step {n}</div>
            <div className="font-display font-semibold text-sm text-text">{title}</div>
            <div className="text-xs text-dim mt-0.5">{sub}</div>
            {href && (
              <a href={href} target="_blank" rel="noreferrer"
                className="inline-block mt-2 text-xs text-accent hover:opacity-70 transition-opacity">
                Open ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileBanner({ onDismiss }) {
  return (
    <div className="fixed inset-0 bg-bg z-50 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="font-display font-bold text-2xl text-accent">piton</p>
      <p className="text-text font-display font-semibold text-lg">Best experienced on desktop</p>
      <p className="text-dim text-sm font-body max-w-xs">Piton is a trading terminal optimised for larger screens. Mobile support is coming soon.</p>
      <button onClick={onDismiss} className="btn-ghost text-sm px-6 py-2">Continue anyway</button>
    </div>
  );
}

export default function Dashboard() {
  const { address, chainId, isConnected } = useAccount();
  const { connect }     = useConnect();
  const { disconnect }  = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const { init, reset, fetchPrice, fetchBalances, fetchOrders, btcBalance, callOrders, putOrders, tick } = useStore();

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('piton_onboarding_dismissed'));
  const [showMobile,     setShowMobile]     = useState(() => window.innerWidth < 1024);

  const isNewUser = showOnboarding && btcBalance !== '—' && parseFloat(btcBalance) === 0 && callOrders.length === 0 && putOrders.length === 0;

  useEffect(() => {
    if (walletClient && chainId === mezoMatsnet.id) init(walletClient, chainId);
    else reset();
  }, [walletClient, chainId]); // eslint-disable-line

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (isConnected && chainId === mezoMatsnet.id) { fetchBalances(); fetchOrders(); }
  }, [tick]); // eslint-disable-line

  const dismissOnboarding = () => { localStorage.setItem('piton_onboarding_dismissed', '1'); setShowOnboarding(false); };

  if (!isConnected) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-bg">
      <p className="font-display text-2xl text-accent">piton</p>
      <p className="text-dim text-sm font-body">Connect your wallet to start trading</p>
      <button className="btn-primary" onClick={() => connect({ connector: injected() })}>Connect Wallet</button>
    </div>
  );

  if (chainId !== mezoMatsnet.id) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 bg-bg">
      <p className="text-dim text-sm font-body">Switch to <span className="text-accent">Mezo Matsnet</span> (Chain ID 31611)</p>
      <button className="btn-primary" onClick={() => switchChain({ chainId: mezoMatsnet.id })}>Switch Network</button>
    </div>
  );

  return (
    <div className="flex flex-col lg:h-screen lg:overflow-hidden bg-bg">
      {showMobile && <MobileBanner onDismiss={() => setShowMobile(false)} />}
      <Navbar onDisconnect={disconnect} />
      <OracleBanner />
      {isNewUser && <OnboardingCard onDismiss={dismissOnboarding} />}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[220px_1fr_280px] gap-2 p-2 lg:overflow-hidden lg:min-h-0">
        <div className="flex flex-col gap-2 lg:overflow-hidden">
          <MarketValue />
          <NewOrder />
        </div>
        <div className="flex flex-col gap-2 lg:overflow-hidden">
          <Graph />
          <OpenOrders />
        </div>
        <div className="flex flex-col gap-2 lg:overflow-hidden">
          <Wallet />
          <YourOrders />
        </div>
      </div>
    </div>
  );
}
