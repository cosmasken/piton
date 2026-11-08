import React from 'react';
import { useStore } from '../store';

export default function MarketValue() {
  const btcPrice = useStore(s => s.btcPrice);
  const fmt = btcPrice ? btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  return (
    <div className="panel px-5 py-4">
      <p className="text-xs tracking-widest uppercase text-dim font-body mb-3">Market</p>
      <div className="space-y-3">
        {[['BTC / USD', `$${fmt}`], ['MUSD / USD', '$1.00'], ['BTC / MUSD', fmt]].map(([label, val]) => (
          <div key={label} className="flex justify-between items-baseline">
            <span className="text-xs text-dim font-body">{label}</span>
            <span className="font-mono text-sm text-accent">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
