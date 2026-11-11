import React, { useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { explorerTx } from '../network.mjs';
import { instrumentName } from '../instruments.mjs';

const ago = s => { const d = Math.max(0, Math.floor(Date.now() / 1000) - s); return d < 90 ? `${d}s` : d < 5400 ? `${Math.round(d / 60)}m` : d < 129600 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`; };

/** Recent fills, newest first, from the pool's OrderFilled events. */
export default function TradesPanel() {
  const { trades, options, network, fetchTrades } = useStore(useShallow(s => ({ trades: s.trades, options: s.options, network: s.network, fetchTrades: s.fetchTrades })));
  useEffect(() => { fetchTrades(); const id = setInterval(fetchTrades, 30_000); return () => clearInterval(id); }, [network]); // eslint-disable-line
  const byId = useMemo(() => Object.fromEntries(options.map(o => [String(o.id), o])), [options]);
  const rows = trades.slice(0, 50).map(t => ({ t, o: byId[String(t.id)] })).filter(r => r.o);
  if (!rows.length) return <div className="flex items-center justify-center h-24 text-dim text-xs">No trades yet</div>;
  return (
    <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg"><tr className="border-b border-border">
          {['Time', 'Option', 'Size', 'Price / BTC', 'Total', 'Against'].map(h => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-dim">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(({ t, o }) => {
            const qty = parseFloat(ethers.formatEther(o.quantity)), prem = parseFloat(ethers.formatEther(o.premium));
            const isCall = o.optionType === 0n;
            return (
              <tr key={`${t.tx}-${t.id}`} className="border-b border-border hover:bg-surface/50">
                <td className="px-3 py-2 font-mono text-dim">{t.time ? ago(t.time) : '—'}</td>
                <td className="px-3 py-2 font-mono"><a href={explorerTx(network, t.tx)} target="_blank" rel="noreferrer" className={isCall ? 'text-accent' : 'text-red'}>{instrumentName({ isCall, strike: parseFloat(ethers.formatEther(o.strike)), expiry: o.expiry }).replace('BTC-', '')}</a></td>
                <td className="px-3 py-2 font-mono">{qty.toFixed(4)}</td>
                <td className="px-3 py-2 font-mono">{(prem / qty).toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
                <td className="px-3 py-2 font-mono">{prem.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-dim">{t.byPool ? 'Pool' : 'Trader'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
