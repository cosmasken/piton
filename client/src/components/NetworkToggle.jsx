import React from 'react';
import { useStore } from '../store';
import { NETWORKS, isLive } from '../network.mjs';

/** Testnet / Mainnet switch. The choice is remembered and drives the whole app. */
export default function NetworkToggle({ className = '' }) {
  const network = useStore(s => s.network);
  const setNetwork = useStore(s => s.setNetwork);

  return (
    <div role="radiogroup" aria-label="Network" className={`flex rounded-md border border-border overflow-hidden text-xs font-display font-semibold ${className}`}>
      {Object.values(NETWORKS).map(n => {
        const active = n.key === network;
        return (
          <button key={n.key} type="button" role="radio" aria-checked={active}
            onClick={() => setNetwork(n.key)}
            className={`px-3 py-1.5 transition-colors flex items-center gap-1.5 ${active ? 'bg-accent/15 text-accent' : 'text-dim hover:text-text'}`}>
            {n.label}
            {!isLive(n) && <span className="text-[9px] font-mono uppercase tracking-wider text-yellow-500/80">soon</span>}
          </button>
        );
      })}
    </div>
  );
}
