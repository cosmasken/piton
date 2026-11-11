import React, { useState } from 'react';
import { ethers } from 'ethers';
import { useStore, ADDRESSES } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { suggestProtection, MCR } from '../troveProtect.mjs';

const TROVE_MANAGER_ABI = [
  'function getTroveStatus(address) view returns (uint256)',
  'function getTroveColl(address) view returns (uint256)',
  'function getTroveDebt(address) view returns (uint256)',
];

const usd = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * Reads the connected wallet's Mezo Trove and suggests a put that pays out as BTC falls toward the
 * liquidation price. `onApply({ strike, qty })` prefills the order form (long put).
 */
export default function ProtectTrove({ onApply }) {
  const { provider, account, chainId, poolContract, btcPrice } = useStore(useShallow(s => ({ provider: s.provider, account: s.account, chainId: s.chainId, poolContract: s.poolContract, btcPrice: s.btcPrice })));
  const [state, setState] = useState({ loading: false, error: null, trove: null, sug: null });
  const [coverage, setCoverage] = useState(100);

  const load = async (cov = coverage) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const tm = new ethers.Contract(ADDRESSES[chainId].troveManager, TROVE_MANAGER_ABI, provider);
      const status = await tm.getTroveStatus(account);
      if (status !== 1n) {
        setState({ loading: false, error: 'No active Mezo Trove found for this wallet.', trove: null, sug: null });
        return;
      }
      const [collWei, debtWei, maxCollWei] = await Promise.all([
        tm.getTroveColl(account), tm.getTroveDebt(account), poolContract.maxOptionCollateral(),
      ]);
      const coll = parseFloat(ethers.formatEther(collWei));
      const debt = parseFloat(ethers.formatEther(debtWei));
      const sug  = suggestProtection({
        coll, debt, spot: btcPrice, coverage: cov / 100,
        maxCollateral: parseFloat(ethers.formatEther(maxCollWei)),
      });
      setState({ loading: false, error: sug ? null : 'Could not size a hedge (empty Trove or no price).', trove: { coll, debt }, sug });
    } catch (e) {
      setState({ loading: false, error: 'Could not read your Trove. Try again.', trove: null, sug: null });
    }
  };

  const { loading, error, trove, sug } = state;

  return (
    <div className="border border-border rounded-md bg-surface/50 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-display font-semibold text-accent">🛡 Protect my Trove</span>
        <button type="button" onClick={() => load()} disabled={loading || !provider}
          className="text-xs text-dim hover:text-accent transition-colors disabled:opacity-40">
          {loading ? 'Reading…' : trove ? 'Refresh' : 'Check'}
        </button>
      </div>
      {!trove && !error && (
        <p className="text-xs text-dim">Hedge liquidation: buy a put that pays MUSD if BTC falls toward your Trove's liquidation price.</p>
      )}
      {error && <p className="text-xs text-red">{error}</p>}
      {sug && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs"><span className="text-dim">Trove</span>
            <span className="font-mono">{trove.coll.toFixed(4)} BTC / {usd(trove.debt)} debt</span></div>
          <div className="flex justify-between text-xs"><span className="text-dim">Collateral ratio</span>
            <span className="font-mono">{(sug.icr * 100).toFixed(0)}%</span></div>
          <div className="flex justify-between text-xs"><span className="text-dim">Liquidation price ({MCR * 100}%)</span>
            <span className="font-mono text-red">{usd(sug.liqPrice)}</span></div>
          <div className="flex justify-between text-xs"><span className="text-dim">Suggested put</span>
            <span className="font-mono">{sug.qty} BTC @ {usd(sug.strike)} strike</span></div>
          <div className="flex justify-between text-xs"><span className="text-dim">Payout if BTC hits liquidation</span>
            <span className="font-mono text-accent">{usd(sug.payoutAtLiq)} ({(sug.payoutPctOfDebt * 100).toFixed(0)}% of debt)</span></div>
          {!sug.otm && <p className="text-xs text-yellow-500">Spot is already below this strike — the put is in the money and will cost more.</p>}
          {sug.capped && <p className="text-xs text-yellow-500">Size reduced to fit the pool's per-option limit.</p>}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-dim">Coverage</span>
            <input type="range" min="10" max="100" step="10" value={coverage}
              onChange={e => { const v = Number(e.target.value); setCoverage(v); load(v); }} className="flex-1" />
            <span className="font-mono w-9 text-right">{coverage}%</span>
          </div>
          <button type="button" onClick={() => onApply({ strike: String(sug.strike), qty: String(sug.qty) })}
            className="w-full py-1.5 text-xs font-display font-semibold border border-accent/40 text-accent rounded hover:bg-accent/10 transition-colors">
            Fill order form with this hedge
          </button>
        </div>
      )}
    </div>
  );
}
