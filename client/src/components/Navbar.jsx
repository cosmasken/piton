import React from 'react';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { startTour } from '../tour';
import { useStore } from '../store';
import { getNetwork, isLive } from '../network.mjs';
import NetworkToggle from './NetworkToggle';

export default function Navbar({ onDisconnect }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const { switchChain } = useSwitchChain();
  const net = getNetwork(useStore(s => s.network));
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';
  const wrongChain = isConnected && chainId !== net.chain.id;

  return (
    <nav className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-bg shrink-0 flex-wrap">
      <div className="flex items-center gap-3">
        <a href="/" className="font-display font-bold text-lg text-accent tracking-tight">piton</a>
        {net.isTestnet && <span className="text-[10px] uppercase tracking-wider text-yellow-500 border border-yellow-700/50 rounded px-1.5 py-0.5">testnet · unaudited</span>}
      </div>
      <div className="flex items-center gap-3">
        <NetworkToggle />
        <button onClick={startTour} className="btn-ghost text-xs">Tour</button>
        {isLive(net) && !isConnected && <button className="btn-primary text-xs" onClick={() => connect({ connector: injected() })}>Connect wallet</button>}
        {wrongChain && <button className="btn-primary text-xs" onClick={() => switchChain({ chainId: net.chain.id })}>Switch to {net.chain.name}</button>}
        {isConnected && <span className="font-mono text-xs text-dim">{short}</span>}
        {isConnected && <button onClick={onDisconnect} className="btn-ghost text-xs">Disconnect</button>}
      </div>
    </nav>
  );
}
