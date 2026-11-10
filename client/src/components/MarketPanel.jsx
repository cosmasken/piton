import React, { useState } from 'react';
import ChainPanel from './ChainPanel';
import OpenOrders from './OpenOrders';
import TradesPanel from './TradesPanel';

const TABS = [['chain', 'Option chain'], ['orders', 'All orders'], ['trades', 'Recent trades']];

/** Centre-bottom area: the option chain (main view), every resting order, and recent fills. */
export default function MarketPanel() {
  const [tab, setTab] = useState('chain');
  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center gap-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`text-xs px-3 py-1 rounded font-display normal-case tracking-normal transition-colors ${tab === k ? 'bg-surface text-text' : 'text-dim hover:text-text'}`}>{label}</button>
        ))}
      </div>
      {tab === 'chain' && <ChainPanel />}
      {tab === 'orders' && <div className="flex flex-col flex-1 min-h-0 [&>.panel]:border-0 [&>.panel]:rounded-none"><OpenOrders /></div>}
      {tab === 'trades' && <TradesPanel />}
    </div>
  );
}
