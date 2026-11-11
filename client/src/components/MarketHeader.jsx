import React, { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useNow } from '../useNow';
import { openInterest, volume24h } from '../market.mjs';
import { breakerActive } from '../poolRules.mjs';

const n = (v, d = 0) => v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function Stat({ label, children, title }) {
  return (
    <div className="shrink-0 px-3 border-r border-border last:border-r-0" title={title}>
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="font-mono text-xs text-text whitespace-nowrap">{children}</div>
    </div>
  );
}

/** Exchange-style ticker strip: index price, 24h stats, volume, open interest, volatility and pool state. */
export default function MarketHeader() {
  const { btcPrice: spot, priceSource, options, trades, poolParams, market, fetchMarket, network } = useStore();
  const now = useNow(30_000);

  useEffect(() => { fetchMarket(); const id = setInterval(fetchMarket, 60_000); return () => clearInterval(id); }, [network]); // eslint-disable-line

  const oi = useMemo(() => openInterest(options, now), [options, now]);
  const vol = useMemo(() => volume24h(trades, options, now), [trades, options, now]);
  const p = poolParams;
  const chg = market?.change24hPct;
  const breaker = p && breakerActive(p.cbUntil, now);

  return (
    <div className="shrink-0 flex items-center overflow-x-auto border-b border-border bg-bg py-2 px-1" aria-label="Market summary">
      <Stat label={`BTC index${priceSource === 'binance' ? ' (Binance)' : ''}`} title="Settlement price from Mezo's Skip oracle">
        <span className="text-accent text-sm">${n(spot, 2)}</span>
      </Stat>
      <Stat label="24h change" title="From Binance BTC/USDT">
        <span className={chg == null ? '' : chg >= 0 ? 'text-accent' : 'text-red'}>{chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`}</span>
      </Stat>
      <Stat label="24h high / low">{n(market?.high24h)} / {n(market?.low24h)}</Stat>
      <Stat label="24h volume" title="Options filled in the last 24 hours (pool and peer to peer)">
        {n(vol.qty, 3)} BTC · {n(vol.premium, 2)} MUSD · {vol.count} trades
      </Stat>
      <Stat label="Open interest" title="Size of live options; put/call ratio by size">
        {n(oi.total, 3)} BTC <span className="text-dim">(C {n(oi.calls, 3)} / P {n(oi.puts, 3)}{oi.putCallRatio != null ? ` · P/C ${oi.putCallRatio.toFixed(2)}` : ''})</span>
      </Stat>
      <Stat label="Pool IV mid / ask" title="Volatility the pool prices with; the ask also rises with pool utilisation">
        {p ? `${(p.iv * 100).toFixed(1)}% / ${(p.askIv * 100).toFixed(1)}%` : '—'}
      </Stat>
      <Stat label="DVOL" title="Deribit's BTC implied volatility index, for comparison">
        {market?.dvol != null ? `${(market.dvol * 100).toFixed(1)}%` : '—'}
      </Stat>
      <Stat label="Pool" title="Pool assets and how much is locked as collateral">
        {p ? <>{n(p.totalAssets)} MUSD · {(p.utilisationBps / 100).toFixed(1)}% used</> : '—'}
      </Stat>
      <Stat label="Pool selling">
        {!p ? '—' : breaker ? <span className="text-red">paused (circuit breaker)</span> : <span className="text-accent">open</span>}
      </Stat>
    </div>
  );
}
