import React, { useState } from 'react';
import { useAccount, useSwitchChain, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { startTour } from '../tour';
import { useStore } from '../store';
import { getNetwork, isLive } from '../network.mjs';
import NetworkToggle from './NetworkToggle';
import Settings from './Settings';

export default function Navbar({ onDisconnect }) {
  const { disconnect } = useDisconnect();
  const onDash = typeof window !== 'undefined' && window.location.pathname.startsWith('/dashboard');
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const net = getNetwork(useStore(s => s.network));
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
  const wrongChain = isConnected && chainId !== net.chain.id;
  const [settings, setSettings] = useState(false);

  return (
    <nav className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-bg shrink-0 flex-wrap">
      <div className="flex items-center gap-3">
        <a href="/" className="font-display font-bold text-lg text-accent tracking-tight">piton</a>
        {net.isTestnet && <span className="text-[10px] uppercase tracking-wider text-yellow-500 border border-yellow-700/50 rounded px-1.5 py-0.5">testnet · unaudited</span>}
      </div>
      <div className="flex items-center gap-3">
        <NetworkToggle />
        {!onDash && <a href="/dashboard" className="btn-ghost text-xs">Trade</a>}
        <a href="/stats" className="btn-ghost text-xs">Stats</a>
        {onDash && <button onClick={startTour} className="btn-ghost text-xs">Tour</button>}
        <button onClick={() => setSettings(true)} className="btn-ghost text-xs" aria-label="Settings" title="Settings">⚙</button>
        {isLive(net) && !isConnected && <button className="btn-primary text-xs" onClick={() => openConnectModal?.()}>Connect wallet</button>}
        {wrongChain && <button className="btn-primary text-xs" onClick={() => switchChain({ chainId: net.chain.id })}>Switch to {net.chain.name}</button>}
        {isConnected && <span className="font-mono text-xs text-dim">{short}</span>}
        {isConnected && <button onClick={onDisconnect || (() => disconnect())} className="btn-ghost text-xs">Disconnect</button>}
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
    </nav>
  );
}
