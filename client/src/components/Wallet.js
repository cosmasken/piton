import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

export default function Wallet({ provider, account }) {
  const [btc, setBtc]   = useState('—');
  const [musd, setMusd] = useState('—');

  useEffect(() => {
    if (!provider || !account) return;
    const update = async () => {
      try {
        const { chainId } = await provider.getNetwork();
        const musdContract = new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, provider);
        const [b, m] = await Promise.all([provider.getBalance(account), musdContract.balanceOf(account)]);
        setBtc(parseFloat(ethers.formatEther(b)).toFixed(4));
        setMusd(parseFloat(ethers.formatUnits(m, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 }));
      } catch {}
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [provider, account]);

  return (
    <div className="panel row-span-1">
      <div className="panel-header">Wallet</div>
      <div className="px-4 py-3 space-y-3">
        {[['BTC', btc], ['MUSD', musd]].map(([sym, bal]) => (
          <div key={sym} className="flex justify-between items-center">
            <span className="text-xs font-display font-semibold text-dim uppercase tracking-wider">{sym}</span>
            <span className="font-mono text-sm text-text">{bal}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
