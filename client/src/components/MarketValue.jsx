import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';

const PYTH_FEEDS = [
  { label: 'MEZO / USD', id: '0x80beaaedbdd228e77c5d62dfcd74b0305674b7e27a5cc6a46e71bd3a696826df' },
  { label: 'SolvBTC / USD', id: '0xf253cf87dc7d5ed5aa14cba5a6e79aee8bcfaef885a0e1b807035a0bbecc36fa' },
  { label: 'cbBTC / USD', id: '0x2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97' },
];

async function fetchPythPrices() {
  const ids = PYTH_FEEDS.map(f => `ids[]=${f.id}`).join('&');
  const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${ids}`);
  const { parsed } = await res.json();
  const map = {};
  parsed.forEach(p => {
    const price = parseFloat(p.price.price) * Math.pow(10, p.price.expo);
    map[`0x${p.id}`] = price;
  });
  return map;
}

export default function MarketValue() {
  const { btcPrice, oracleStale, priceSource } = useStore(useShallow(s => ({ btcPrice: s.btcPrice, oracleStale: s.oracleStale, priceSource: s.priceSource })));
  const [pythPrices, setPythPrices] = useState({});

  useEffect(() => {
    fetchPythPrices().then(setPythPrices).catch(() => {});
    const id = setInterval(() => fetchPythPrices().then(setPythPrices).catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, []);

  const fmtPrice = v => v ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const btcFmt   = btcPrice ? btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  return (
    <div className="panel px-5 py-4 space-y-4">
      <p className="text-xs tracking-widest uppercase text-dim font-body">Market</p>

      {/* BTC prices */}
      <div className="space-y-2">
        {[
          ['BTC / USD', `$${btcFmt}`, oracleStale ? 'Binance' : 'Skip'],
          ['MUSD / USD', '$1.00', 'pegged'],
          ['BTC / MUSD', btcFmt, null],
        ].map(([label, val, source]) => (
          <div key={label} className="flex justify-between items-baseline">
            <div>
              <span className="text-xs text-dim font-body">{label}</span>
              {source && <span className="ml-1.5 text-[9px] text-dim/50 font-mono">{source}</span>}
            </div>
            <span className="font-mono text-sm text-accent">{val}</span>
          </div>
        ))}
      </div>

      {/* Pyth multi-asset prices */}
      {PYTH_FEEDS.some(f => pythPrices[f.id]) && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-dim/60 font-body">Mezo Ecosystem (Pyth)</p>
          {PYTH_FEEDS.map(f => (
            <div key={f.id} className="flex justify-between items-baseline">
              <span className="text-xs text-dim font-body">{f.label}</span>
              <span className="font-mono text-xs text-text">{fmtPrice(pythPrices[f.id])}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
