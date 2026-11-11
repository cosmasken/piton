import React, { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './store';
import { parseInstrumentId } from './instruments.mjs';
import { getNetwork, isLive } from './network.mjs';
import { NotLiveBanner, LockedWhenNotLive, WatchBanner } from './components/NotLive';

import Navbar      from './components/Navbar';
import TradePanel   from './components/TradePanel';
import Graph       from './components/graph';
import MarketPanel  from './components/MarketPanel';
import AccountSummary from './components/AccountSummary';
import YourOrders  from './components/YourOrders';
import Pool        from './components/Pool';
import MarketHeader from './components/MarketHeader';
import ExpiryAlerts from './components/ExpiryAlerts';
import { useNow } from './useNow';
import { breakerActive } from './poolRules.mjs';

function OracleBanner() {
  const { oracleStale, priceSource } = useStore(useShallow(s => ({ oracleStale: s.oracleStale, priceSource: s.priceSource })));
  if (!oracleStale && priceSource !== 'binance') return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-yellow-900/40 border-b border-yellow-700/40 text-yellow-400 text-xs font-body">
      <span>⚠</span>
      <span>Skip oracle price is stale — showing <strong>Binance fallback price</strong>. On-chain actions may revert until the oracle updates.</span>
    </div>
  );
}

function BreakerBanner() {
  const params = useStore(s => s.poolParams);
  const now = useNow(5000);
  if (!params || !breakerActive(params.cbUntil, now)) return null;
  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red/10 border-b border-red/30 text-red text-xs font-body">
      <span>⛔</span>
      <span><strong>Circuit breaker active</strong> after a fast price move: the pool is not selling new options and is not taking deposits until {new Date(params.cbUntil * 1000).toLocaleTimeString()}. Withdrawals, exercising and refunds still work.</span>
    </div>
  );
}

function OnboardingCard({ onDismiss }) {
  const net = getNetwork(useStore(s => s.network));
  // Faucet only exists on testnet; on mainnet users bring BTC and borrow MUSD on Mezo.
  const steps = net.isTestnet
    ? [['Get test BTC', 'From the Mezo faucet', net.faucetUrl],
       ['Borrow MUSD', 'Against your test BTC', net.borrowUrl],
       ['Place an order', 'Use the New Order panel', null]]
    : [['Borrow MUSD', 'Against your BTC on Mezo', net.borrowUrl],
       ['Place an order', 'Use the New Order panel', null]];
  return (
    <div className="mx-2 mt-2 panel px-5 py-4 shrink-0">
      <div className="flex items-start justify-between mb-3">
        <p className="font-display font-semibold text-sm text-text">Get started with Piton</p>
        <button onClick={onDismiss} className="text-dim text-xs hover:text-text transition-colors">Dismiss</button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {steps.map(([title, sub, href], i) => [String(i + 1), title, sub, href]).map(([n, title, sub, href]) => (
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
      <p className="text-dim text-sm font-body max-w-xs">Piton is a trading terminal designed for larger screens. On a phone the panels stack and tables scroll sideways.</p>
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

  const { init, reset, fetchOptions, fetchTrades, refreshState, startLive, stopLive, setSelected, btcBalance, optionCount, tick, network } = useStore(useShallow(s => ({
    init: s.init, reset: s.reset, fetchOptions: s.fetchOptions, fetchTrades: s.fetchTrades, refreshState: s.refreshState,
    startLive: s.startLive, stopLive: s.stopLive, setSelected: s.setSelected, btcBalance: s.btcBalance,
    optionCount: s.options.length, tick: s.tick, network: s.network,
  })));
  const net  = getNetwork(network);
  const live = isLive(net);
  const onSelectedChain = chainId === net.chain.id;

  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('piton_onboarding_dismissed'));
  const [showMobile,     setShowMobile]     = useState(() => window.innerWidth < 1024);

  const isNewUser = showOnboarding && btcBalance !== '—' && parseFloat(btcBalance) === 0 && optionCount === 0;

  useEffect(() => {
    if (live && walletClient && onSelectedChain) init(walletClient, chainId);
    else reset();
  }, [walletClient, chainId, network]); // eslint-disable-line

  useEffect(() => {
    const link = parseInstrumentId(new URLSearchParams(window.location.search).get('i'));
    if (link && link.expiry > Math.floor(Date.now() / 1000)) setSelected({ ...link, side: 'buy' });
  }, []); // eslint-disable-line

  // full load once per network, then the live engine keeps everything current block by block
  useEffect(() => {
    fetchOptions();
    fetchTrades();
    startLive();
    return () => stopLive();
  }, [network]); // eslint-disable-line

  // wallet history from the subgraph, and auto-exercise flags of its live positions
  const account = useStore(s => s.account);
  const myLiveIds = useStore(s => {
    const me = s.account?.toLowerCase(), now = Math.floor(Date.now() / 1000);
    return me ? s.options.filter(o => Number(o.status) === 1 && Number(o.expiry) > now && o.long?.toLowerCase() === me).map(o => String(o.id)).join(',') : '';
  });
  useEffect(() => { useStore.getState().fetchHistory(); }, [account, network]);
  useEffect(() => { useStore.getState().fetchAutoEx(); }, [account, myLiveIds]);

  // after the user's own transaction: refresh at once rather than waiting for the next block
  useEffect(() => {
    if (live && isConnected && onSelectedChain) { refreshState(); fetchOptions(); }
  }, [tick]); // eslint-disable-line

  const dismissOnboarding = () => { localStorage.setItem('piton_onboarding_dismissed', '1'); setShowOnboarding(false); };

  // Anyone can browse the chain, book and pool without a wallet; connecting is only needed to trade.
  return (
    <div className="flex flex-col lg:h-screen lg:overflow-hidden bg-bg">
      {showMobile && <MobileBanner onDismiss={() => setShowMobile(false)} />}
      <Navbar onDisconnect={disconnect} />
      {live && <MarketHeader />}
      <NotLiveBanner />
      <WatchBanner />
      {live && <OracleBanner />}
      {live && <BreakerBanner />}
      {live && <ExpiryAlerts />}
      {live && isNewUser && <OnboardingCard onDismiss={dismissOnboarding} />}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)_340px] gap-2 p-2 lg:overflow-hidden lg:min-h-0">
        <div className="flex flex-col gap-2 lg:overflow-y-auto lg:min-h-0">
          <LockedWhenNotLive><AccountSummary /></LockedWhenNotLive>
          <LockedWhenNotLive><div data-tour="pool" className="flex flex-col"><Pool /></div></LockedWhenNotLive>
        </div>
        <div className="flex flex-col gap-2 lg:overflow-hidden lg:min-h-0">
          <div data-tour="chart" className="flex flex-col h-64 lg:h-auto lg:flex-[2] lg:min-h-0 overflow-hidden"><Graph /></div>
          <LockedWhenNotLive className="flex flex-col min-h-[420px] lg:min-h-0 lg:flex-[4] overflow-hidden"><div data-tour="open-orders" className="flex flex-col flex-1 min-h-0 overflow-hidden"><MarketPanel /></div></LockedWhenNotLive>
        </div>
        <div className="flex flex-col gap-2 lg:overflow-hidden lg:min-h-0">
          <LockedWhenNotLive className="flex flex-col min-h-[520px] lg:min-h-0 lg:flex-[3] overflow-hidden"><div data-tour="new-order" className="flex flex-col flex-1 min-h-0 overflow-hidden"><TradePanel /></div></LockedWhenNotLive>
          <LockedWhenNotLive className="flex flex-col min-h-[260px] lg:min-h-0 lg:flex-[2] overflow-hidden"><div data-tour="your-orders" className="flex flex-col flex-1 min-h-0 overflow-hidden"><YourOrders /></div></LockedWhenNotLive>
        </div>
      </div>
    </div>
  );
}
