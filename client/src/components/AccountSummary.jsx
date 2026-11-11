import React, { useMemo } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { useNow } from '../useNow';
import { livePositions, realisedPnl, lpPosition } from '../portfolio.mjs';
import { Flash } from './Live';

const n = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${n(v)}`);

function Line({ label, children, title, tone = 'text-text' }) {
  return (
    <div className="flex justify-between items-baseline gap-2" title={title}>
      <span className="text-xs text-dim">{label}</span>
      <span className={`font-mono text-xs ${tone}`}>{children}</span>
    </div>
  );
}

/** One place for the wallet's money: balances, pool share, open positions and P&L (open and realised). */
export default function AccountSummary() {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { account, btcBalance, musdRaw, ymusdRaw, poolShareValue, options, btcPrice, poolParams, history, oracleStale, priceSource } = useStore(useShallow(s => ({
    account: s.account, btcBalance: s.btcBalance, musdRaw: s.musdRaw, ymusdRaw: s.ymusdRaw, poolShareValue: s.poolShareValue,
    options: s.options, btcPrice: s.btcPrice, poolParams: s.poolParams, history: s.history, oracleStale: s.oracleStale, priceSource: s.priceSource,
  })));
  const now = useNow(15_000);
  const iv = poolParams?.iv || 0.8;
  const { totals } = useMemo(() => livePositions(options, account, btcPrice, iv, now), [options, account, btcPrice, iv, now]);
  const realised = useMemo(() => (history ? realisedPnl(history.ended, account) : null), [history, account]);
  const sv = parseFloat(poolShareValue), shares = parseFloat(ymusdRaw) || 0, musd = parseFloat(musdRaw) || 0;
  const lp = history?.account ? lpPosition(history.account, shares, sv, null) : null;
  const poolValue = Number.isFinite(sv) ? shares * sv : 0;
  const btcUsd = btcBalance !== '—' && btcPrice ? parseFloat(btcBalance) * btcPrice : null;
  const net = musd + poolValue + totals.value;

  return (
    <div className="panel" data-tour="wallet">
      <div className="panel-header flex items-center justify-between">
        <span>Account</span>
        <span className={`text-[10px] font-mono normal-case tracking-normal ${oracleStale ? 'text-yellow-500' : 'text-dim'}`}>
          {oracleStale ? '⚠ stale oracle' : priceSource === 'binance' ? 'binance price' : 'skip oracle'}
        </span>
      </div>
      {!account ? (
        <div className="px-4 py-4 space-y-2 text-center">
          <p className="text-xs text-dim">Connect a wallet to see balances, positions and P&L.</p>
          {!isConnected && <button className="btn-primary text-xs w-full" onClick={() => connect({ connector: injected() })}>Connect wallet</button>}
        </div>
      ) : (
        <div className="px-4 py-3 space-y-1.5">
          <Line label="MUSD in wallet"><Flash value={Math.round(musd * 100)}>{n(musd)}</Flash></Line>
          <Line label="BTC in wallet" title={btcUsd != null ? `≈ $${n(btcUsd, 0)}` : ''}>{btcBalance}</Line>
          <Line label="Pool share" title={`${n(shares, 4)} yMUSD × ${poolShareValue} MUSD`}><Flash value={Math.round(poolValue * 100)}>{n(poolValue)}</Flash></Line>
          <Line label="Open positions" title="Fair value of your open options (shorts count as negative)"><Flash value={Math.round(totals.value * 100)}>{n(totals.value)}</Flash></Line>
          <div className="border-t border-border my-1" />
          <Line label="Account value (MUSD)" title="Wallet MUSD + pool share + open positions"><Flash value={Math.round(net * 100)}>{n(net)}</Flash></Line>
          <Line label="Open P&L" tone={totals.pnl >= 0 ? 'text-accent' : 'text-red'}><Flash value={Math.round(totals.pnl * 100)}>{signed(totals.pnl)}</Flash></Line>
          <Line label="Realised P&L" title="Ended options: exercised, sold back or expired" tone={realised && realised.total < 0 ? 'text-red' : 'text-accent'}>
            {realised ? signed(realised.total) : history === null ? '—' : '0.00'}
          </Line>
          {lp && (lp.deposited > 0 || lp.withdrawn > 0) && (
            <Line label="Pool P&L" title={`Deposited ${n(lp.deposited)}, withdrawn ${n(lp.withdrawn)}, now worth ${n(lp.value)}`} tone={lp.pnl >= 0 ? 'text-accent' : 'text-red'}>{signed(lp.pnl)}</Line>
          )}
        </div>
      )}
    </div>
  );
}
