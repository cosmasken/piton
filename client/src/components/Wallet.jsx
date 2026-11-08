import React from 'react';
import { useStore } from '../store';

export default function Wallet() {
  const btcBalance  = useStore(s => s.btcBalance);
  const musdBalance = useStore(s => s.musdBalance);
  return (
    <div className="panel">
      <div className="panel-header">Wallet</div>
      <div className="px-4 py-3 space-y-3">
        {[['BTC', btcBalance], ['MUSD', musdBalance]].map(([sym, bal]) => (
          <div key={sym} className="flex justify-between items-center">
            <span className="text-xs font-display font-semibold text-dim uppercase tracking-wider">{sym}</span>
            <span className="font-mono text-sm text-text">{bal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
