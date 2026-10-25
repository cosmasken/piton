import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

const PYTH_ADDRESS = '0x2880aB155794e7179c9eE2e38200202908C17B43';

export default function MarketValue({ callContract }) {
  const [btc, setBtc] = useState('—');

  useEffect(() => {
    if (!callContract) return;

    const update = async () => {
      try {
        const raw = await callContract.getMarketValue();
        setBtc(parseFloat(ethers.formatUnits(raw, 18)).toFixed(2));
      } catch {
        // fallback to Binance if oracle call fails via wallet RPC
        try {
          const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
          const { price } = await res.json();
          setBtc(parseFloat(price).toFixed(2));
        } catch {}
      }
    };

    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [callContract]);

  return (
    <div className='sec-bg market-val'>
      <table className='text-center text-white' style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td><span className='font-weight-bold text-secondary'>BTC/USD</span></td>
            <td>$ {btc}</td>
          </tr>
          <tr>
            <td><span className='font-weight-bold text-secondary'>MUSD/USD</span></td>
            <td>$ 1.00</td>
          </tr>
          <tr>
            <td><span className='font-weight-bold text-secondary'>BTC/MUSD</span></td>
            <td>MUSD {btc}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
