import React, { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, STATUS, TYPE } from '../store';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import { SkeletonRow } from './Skeleton';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const fmt = v => v == null ? 0 : parseFloat(ethers.formatEther(v));

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function StatusBadge({ status, expiry }) {
  const now = Math.floor(Date.now() / 1000);
  if (status === STATUS.SETTLED)  return <span className="text-[10px] text-dim bg-surface px-1.5 py-0.5 rounded">Settled</span>;
  if (status === STATUS.REFUNDED) return <span className="text-[10px] text-dim bg-surface px-1.5 py-0.5 rounded">Refunded</span>;
  if (Number(expiry) < now)       return <span className="text-[10px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">Expired</span>;
  if (status === STATUS.FILLED)   return <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">Live</span>;
  return <span className="text-[10px] text-dim bg-surface px-1.5 py-0.5 rounded">Open</span>;
}

function OptionRow({ o, account, btcPrice, poolContract, musdContract, refresh }) {
  const exp    = useCountdown(o.expiry);
  const isCall = o.optionType === TYPE.CALL;
  const isLong = o.long?.toLowerCase() === account?.toLowerCase();
  const now    = Math.floor(Date.now() / 1000);
  const spot   = btcPrice;

  const profit = isCall
    ? Math.max(0, spot - fmt(o.strike)) * fmt(o.quantity)
    : Math.max(0, fmt(o.strike) - spot) * fmt(o.quantity);
  const isITM  = profit > 0;
  const canSettle = o.status === STATUS.FILLED && isLong && isITM && Number(o.expiry) > now;
  const canRefund = o.status === STATUS.FILLED && Number(o.expiry) <= now;
  const canCancel = o.status === STATUS.OPEN && (
    (isLong && o.short === ethers.ZeroAddress) ||
    (o.short?.toLowerCase() === account?.toLowerCase() && o.long === ethers.ZeroAddress)
  );

  const [loading, setLoading] = useState(false);

  const act = async (fn, msg) => {
    setLoading(true);
    try {
      const tx = await fn();
      refresh();
      toast.success(<TxToast msg={msg} hash={tx?.hash} />);
    } catch (e) { toast.error(parseTxError(e)); }
    finally { setLoading(false); }
  };

  return (
    <tr className="border-b border-border hover:bg-surface/50 transition-colors">
      <td className="px-3 py-2.5"><span className={isCall ? 'tag-call' : 'tag-put'}>{isCall ? 'Call' : 'Put'}</span></td>
      <td className="px-3 py-2.5 text-xs text-dim">{isLong ? 'Long' : 'Short'}</td>
      <td className="px-3 py-2.5 font-mono text-xs">{fmt(o.strike).toLocaleString()}</td>
      <td className="px-3 py-2.5 font-mono text-xs">{fmt(o.quantity).toFixed(4)}</td>
      <td className="px-3 py-2.5 font-mono text-xs">{exp}</td>
      <td className="px-3 py-2.5">
        {isITM && o.status === STATUS.FILLED && <span className="text-[10px] text-accent">+${profit.toFixed(2)}</span>}
        {!isITM && o.status === STATUS.FILLED && <StatusBadge status={o.status} expiry={o.expiry} />}
        {o.status !== STATUS.FILLED && <StatusBadge status={o.status} expiry={o.expiry} />}
      </td>
      <td className="px-3 py-2.5">
        {loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin inline-block" />}
        {!loading && canSettle && (
          <button onClick={() => act(() => poolContract.settle(o.id).then(tx => tx.wait()), 'Settled!')}
            className="text-accent text-xs font-display font-semibold hover:opacity-70">Settle</button>
        )}
        {!loading && canRefund && (
          <button onClick={() => act(() => poolContract.refund(o.id).then(tx => tx.wait()), 'Refunded!')}
            className="text-dim text-xs hover:text-text transition-colors">Refund</button>
        )}
        {!loading && canCancel && (
          <button onClick={() => act(() => poolContract.cancelOrder(o.id).then(tx => tx.wait()), 'Cancelled!')}
            className="text-dim text-xs hover:text-text transition-colors">Cancel</button>
        )}
      </td>
    </tr>
  );
}

export default function YourOrders() {
  const { account, poolContract, musdContract, btcPrice, options, ordersLoading, refresh } = useStore();
  const [tab, setTab] = useState('active');

  const mine = options.filter(o =>
    o.long?.toLowerCase()  === account?.toLowerCase() ||
    o.short?.toLowerCase() === account?.toLowerCase()
  );

  const now = Math.floor(Date.now() / 1000);
  const active = mine.filter(o => o.status === STATUS.OPEN || o.status === STATUS.FILLED);
  const history = mine.filter(o => o.status === STATUS.SETTLED || o.status === STATUS.REFUNDED ||
    (o.status === STATUS.FILLED && Number(o.expiry) <= now));

  const list = tab === 'active' ? active : history;

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center gap-2">
        <span>Your Positions</span>
        <div className="flex gap-1 ml-auto">
          {['active','history'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2 py-0.5 rounded capitalize font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {ordersLoading ? (
          <div>{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : !account ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">Connect wallet to see positions</div>
        ) : list.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">No {tab} positions</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                {['Type','Side','Strike','Qty','Expiry','P&L',''].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-dim">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((o, i) => (
                <OptionRow key={i} o={o} account={account} btcPrice={btcPrice}
                  poolContract={poolContract} musdContract={musdContract} refresh={refresh} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
