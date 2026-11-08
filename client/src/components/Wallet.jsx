import React from 'react';
import { useStore } from '../store';

export default function Wallet() {
  const btcBalance  = useStore(s => s.btcBalance);
  const musdBalance = useStore(s => s.musdBalance);
  const btcPrice    = useStore(s => s.btcPrice);
  const oracleStale = useStore(s => s.oracleStale);
  const priceSource = useStore(s => s.priceSource);

  const btcUsd = btcBalance !== '—' && btcPrice
    ? `≈ $${(parseFloat(btcBalance) * btcPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null;

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <span>Wallet</span>
        <span className={`text-[10px] font-mono ${oracleStale ? 'text-yellow-500' : 'text-dim'}`}>
          {oracleStale ? '⚠ stale oracle' : priceSource === 'binance' ? 'binance price' : 'skip oracle'}
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-display font-semibold text-dim uppercase tracking-wider">BTC</span>
          <div className="text-right">
            <div className="font-mono text-sm text-text">{btcBalance}</div>
            {btcUsd && <div className="font-mono text-[10px] text-dim">{btcUsd}</div>}
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs font-display font-semibold text-dim uppercase tracking-wider">MUSD</span>
          <div className="font-mono text-sm text-text">{musdBalance}</div>
        </div>
      </div>
    </div>
  );
}
