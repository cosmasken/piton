import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { LineChart, Line, ReferenceLine, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore } from '../store';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const fmt = v => parseFloat(ethers.formatUnits(v, 18));

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function payoffCurve(isCall, isLong, sp, cost, qty, spot) {
  const range = sp * 0.3;
  return Array.from({ length: 21 }, (_, i) => {
    const price = (sp - range) + (i / 20) * range * 2;
    const pnl = isCall
      ? (isLong ? (Math.max(0, price - sp) - cost) * qty : (cost - Math.max(0, price - sp)) * qty)
      : (isLong ? (Math.max(0, sp - price) - cost) * qty : (cost - Math.max(0, sp - price)) * qty);
    return { price, pnl };
  });
}

function PositionRow({ o, isCall, account, btcPrice, onAction }) {
  const exp    = useCountdown(o.expiry);
  const sp     = fmt(o.strikePrice), qty = fmt(o.quantity), cost = fmt(o.cost);
  const isLong = o.partyS !== account;
  const PL     = !o.isAvailable && exp !== 'Expired'
    ? (isCall ? (isLong ? btcPrice - sp - cost : cost - Math.max(0, btcPrice - sp))
              : (isLong ? sp - btcPrice - cost  : cost - Math.max(0, sp - btcPrice))) * qty
    : null;

  let action = null;
  if (o.isAvailable)       action = isCall ? 'closeCall'  : 'closePut';
  else if (exp === 'Expired') action = isCall ? 'refundCall' : 'refundPut';
  else if (isLong)            action = isCall ? 'settleCall' : 'settlePut';

  const curve = btcPrice ? payoffCurve(isCall, isLong, sp, cost, qty, btcPrice) : [];

  return (
    <div className="border-b border-border px-4 py-3 hover:bg-surface/30 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={isLong ? 'tag-call' : 'tag-put'}>{isLong ? 'Long' : 'Short'}</span>
          <span className="font-mono text-xs text-dim">Strike ${sp.toLocaleString()}</span>
          <span className="font-mono text-xs text-dim">{exp}</span>
        </div>
        <div className="flex items-center gap-3">
          {PL !== null && (
            <span className={`font-mono text-xs font-semibold ${PL > 0 ? 'text-accent' : 'text-red'}`}>
              {PL > 0 ? '+' : ''}{PL.toFixed(1)} MUSD
            </span>
          )}
          {action && (
            <button onClick={() => onAction({ order: o, action })}
              className={`text-xs font-display font-semibold hover:opacity-70 transition-opacity ${action.startsWith('settle') ? 'text-accent' : 'text-dim'}`}>
              {action.startsWith('settle') ? 'Settle →' : action.startsWith('close') ? 'Close' : 'Refund'}
            </button>
          )}
        </div>
      </div>
      {curve.length > 0 && (
        <div className="h-12">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <ReferenceLine y={0} stroke="#1a1a1a" strokeDasharray="3 3" />
              {btcPrice && <ReferenceLine x={btcPrice} stroke="#3a5a3a" strokeDasharray="2 2" />}
              <Tooltip
                contentStyle={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 4, fontSize: 10, padding: '2px 6px' }}
                formatter={v => [`${v > 0 ? '+' : ''}${v.toFixed(1)}`, 'P/L']}
                labelFormatter={v => `$${parseFloat(v).toFixed(0)}`}
              />
              <Line type="monotone" dataKey="pnl" dot={false} strokeWidth={1.5}
                stroke={PL !== null && PL > 0 ? '#00ff88' : '#ff4466'} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function YourOrders() {
  const { account, callContract, putContract, musdContract, btcPrice, refresh } = useStore();
  const tick = useStore(s => s.tick);

  const [callOrders, setCallOrders] = useState([]);
  const [putOrders,  setPutOrders]  = useState([]);
  const [tab,        setTab]        = useState('call');
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(null);
  const [btnLoad,    setBtnLoad]    = useState(false);

  useEffect(() => {
    if (!account || !callContract) return;
    setLoading(true);
    const load = async (contract) => {
      const count = await contract.getOptionsCount(account);
      const orders = [];
      for (let i = Number(count) - 1; i >= 0; i--) {
        try { const id = await contract.addressToOptions(account, i); const o = await contract.idToOption(id); if (!o.settled) orders.push(o); } catch {}
      }
      return orders;
    };
    Promise.all([load(callContract), load(putContract)])
      .then(([c, p]) => { setCallOrders(c); setPutOrders(p); })
      .finally(() => setLoading(false));
  }, [account, callContract, putContract, tick]); // eslint-disable-line

  const run = async (fn, msg) => {
    setBtnLoad(true);
    try {
      const tx = await fn();
      refresh();
      toast.success(<TxToast msg={msg} hash={tx?.hash} />);
      setModal(null);
    } catch (e) { toast.error(parseTxError(e)); }
    finally { setBtnLoad(false); }
  };

  const actions = {
    closeCall:  () => run(async () => (await callContract.closeOption(modal.order.id)).wait(),  'Order closed.'),
    refundCall: () => run(async () => (await callContract.refundExpired(modal.order.id)).wait(), 'Escrow refunded.'),
    settleCall: () => run(async () => {
      const o = modal.order;
      if (Number(o.settlementType) === 0) await (await musdContract.approve(await callContract.getAddress(), o.strikePrice)).wait();
      return (await callContract.settleOption(o.id)).wait();
    }, 'Option settled.'),
    closePut:   () => run(async () => (await putContract.closeOption(modal.order.id)).wait(),  'Order closed.'),
    refundPut:  () => run(async () => (await putContract.refundExpired(modal.order.id)).wait(), 'Escrow refunded.'),
    settlePut:  () => run(async () => {
      const o = modal.order;
      return (await putContract.settleOption(o.id, { value: Number(o.settlementType) === 0 ? o.quantity : 0n })).wait(); // eslint-disable-line no-undef
    }, 'Option settled.'),
  };

  const orders = tab === 'call' ? callOrders : putOrders;
  const isCall = tab === 'call';

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center justify-between">
        <span>Your Positions</span>
        <div className="flex gap-1">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1 rounded uppercase tracking-wider font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">No {tab} positions</div>
        ) : orders.map((o, i) => (
          <PositionRow key={i} o={o} isCall={isCall} account={account} btcPrice={btcPrice} onAction={setModal} />
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="panel w-80 p-6 space-y-4">
            <p className="font-display font-semibold">Confirm</p>
            <p className="text-sm text-dim font-body">
              {modal.action.startsWith('settle') ? 'Settle and receive payout.' : modal.action.startsWith('close') ? 'Refund escrowed collateral.' : 'Reclaim expired escrow.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={actions[modal.action]} disabled={btnLoad}
                className="btn-primary flex-1 disabled:opacity-50 flex items-center justify-center gap-2">
                {btnLoad && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
                {btnLoad ? 'Confirming…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
