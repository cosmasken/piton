import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

export default function MarketValue({ callContract }) {
  const [btc, setBtc] = useState('—');

  useEffect(() => {
    if (!callContract) return;
    const update = async () => {
      try {
        const raw = await callContract.getMarketValue();
        setBtc(parseFloat(ethers.formatUnits(raw, 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      } catch {
        try {
          const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
          setBtc(parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        } catch {}
      }
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [callContract]);

  return (
    <div className="panel flex flex-col justify-center px-5 py-4 row-span-1">
      <p className="text-xs tracking-widest uppercase text-dim font-body mb-3">Market</p>
      <div className="space-y-3">
        {[['BTC / USD', `$${btc}`], ['MUSD / USD', '$1.00'], ['BTC / MUSD', `${btc}`]].map(([label, val]) => (
          <div key={label} className="flex justify-between items-baseline">
            <span className="text-xs text-dim font-body">{label}</span>
            <span className="font-mono text-sm text-accent">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
