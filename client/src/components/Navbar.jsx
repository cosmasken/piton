import React from 'react';
import { useAccount } from 'wagmi';

export default function Navbar({ onDisconnect }) {
  const { address } = useAccount();
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';

  return (
    <nav className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg shrink-0">
      <a href="/" className="font-display font-bold text-lg text-accent tracking-tight">piton</a>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-dim">{short}</span>
        <button onClick={onDisconnect} className="btn-ghost text-xs">Disconnect</button>
      </div>
    </nav>
  );
}
