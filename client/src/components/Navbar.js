import React from 'react';

export default function Navbar({ account, onDisconnect }) {
  const short = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : '';
  return (
    <nav className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg shrink-0">
      <a href="/" className="font-display font-bold text-lg text-accent tracking-tight">piton</a>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-dim">{short}</span>
        <div className="w-2 h-2 rounded-full bg-accent" />
        <button
          onClick={onDisconnect}
          className="btn-ghost text-xs px-3 py-1.5"
        >
          Disconnect
        </button>
      </div>
    </nav>
  );
}
