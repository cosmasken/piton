import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { LineChart, Line, ReferenceLine, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore } from '../store';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import { greeks } from '../greeks';
import Modal from './Modal';
import { SkeletonRow } from './Skeleton';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const fmt = v => v == null ? 0 : parseFloat(ethers.formatUnits(v, 18));

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function Row({ label, value, accent, red }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ? 'text-accent' : red ? 'text-red' : 'text-text'}`}>{value}</span>
    </div>
  );
}

function payoffCurve(isCall, isLong, sp, cost, qty) {
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
  const hoursLeft = Math.max(0, (Number(o.expiry) - Date.now() / 1000) / 3600);
  const g = btcPrice ? greeks(isCall, btcPrice, sp, hoursLeft) : { delta: null, theta: null };
  const PL = !o.isAvailable && exp !== 'Expired'
    ? (isCall ? (isLong ? btcPrice - sp - cost : cost - Math.max(0, btcPrice - sp))
              : (isLong ? sp - btcPrice - cost  : cost - Math.max(0, sp - btcPrice))) * qty
    : null;

  let action = null;
  if (o.isAvailable)          action = isCall ? 'closeCall'  : 'closePut';
  else if (exp === 'Expired') action = isCall ? 'refundCall' : 'refundPut';
  else if (isLong)            action = isCall ? 'settleCall' : 'settlePut';

  const curve = btcPrice ? payoffCurve(isCall, isLong, sp, cost, qty) : [];

  return (
    <div className="border-b border-border px-4 py-3 hover:bg-surface/30 transition-colors">
      <div className="flex items-center justify-between mb-1">
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
            <button onClick={() => onAction({ order: o, action, isCall, isLong, sp, qty, cost, PL })}
              className={`text-xs font-display font-semibold hover:opacity-70 transition-opacity ${action.startsWith('settle') ? 'text-accent' : 'text-dim'}`}>
              {action.startsWith('settle') ? 'Settle →' : action.startsWith('close') ? 'Close' : 'Refund'}
            </button>
          )}
        </div>
      </div>
      {g.delta !== null && (
        <div className="flex gap-3 mb-1">
          <span className="text-[10px] font-mono text-dim">Δ <span className="text-text">{g.delta}</span></span>
          <span className="text-[10px] font-mono text-dim">Θ <span className="text-text">{g.theta}/day</span></span>
          <span className="text-[10px] font-mono text-dim/50">IV 80%</span>
        </div>
      )}
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

function ActionModal({ modal, onClose, onConfirm, loading }) {
  if (!modal) return null;
  const { action, isCall, isLong, sp, qty, cost, PL, order } = modal;

  const isSettle = action.startsWith('settle');
  const isClose  = action.startsWith('close');
  const isRefund = action.startsWith('refund');

  const title = isSettle ? 'Settle Option' : isClose ? 'Close Order' : 'Refund Expired';

  const payout = isSettle && PL !== null
    ? (isCall
        ? (isLong ? `${(Math.max(0, 0) + cost * qty).toFixed(2)} MUSD` : null) // simplified
        : null)
    : null;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-1 bg-surface rounded-md px-3 py-3">
        <Row label="Type"    value={`${isLong ? 'Long' : 'Short'} ${isCall ? 'Call' : 'Put'}`} />
        <Row label="Strike"  value={`$${sp?.toLocaleString()}`} />
        <Row label="Qty"     value={`${qty?.toFixed(4)} BTC`} />
        <Row label="Premium" value={`${cost?.toFixed(2)} MUSD`} />
        {PL !== null && <Row label="Est. P/L" value={`${PL > 0 ? '+' : ''}${PL?.toFixed(2)} MUSD`} accent={PL > 0} red={PL <= 0} />}
      </div>

      {isSettle && (
        <p className="text-xs text-dim bg-accent/5 border border-accent/20 rounded px-2 py-1.5">
          {isCall
            ? isLong ? 'You pay strike in MUSD and receive BTC (or cash-settled profit).' : 'Short call settled against you.'
            : isLong ? 'You send BTC and receive strike in MUSD (or cash-settled profit).' : 'Short put settled against you.'}
        </p>
      )}
      {isClose && (
        <p className="text-xs text-dim bg-surface border border-border rounded px-2 py-1.5">
          Cancels your open order and returns escrowed collateral.
        </p>
      )}
      {isRefund && (
        <p className="text-xs text-dim bg-surface border border-border rounded px-2 py-1.5">
          Option expired unexercised. Reclaims your escrowed collateral.
        </p>
      )}

      <div className="flex gap-3">
        <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
        <button onClick={onConfirm} disabled={loading}
          className="btn-primary flex-1 disabled:opacity-50 flex items-center justify-center gap-2">
          {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
          {loading ? 'Confirming…' : isSettle ? 'Settle & Collect' : isClose ? 'Close Order' : 'Claim Refund'}
        </button>
      </div>
    </Modal>
  );
}

export default function YourOrders() {
  const { account, callContract, putContract, musdContract, btcPrice, refresh } = useStore();
  const tick = useStore(s => s.tick);

  const [callOrders,  setCallOrders]  = useState([]);
  const [putOrders,   setPutOrders]   = useState([]);
  const [callHistory, setCallHistory] = useState([]);
  const [putHistory,  setPutHistory]  = useState([]);
  const [tab,         setTab]         = useState('call');
  const [view,        setView]        = useState('open');
  const [loading,     setLoading]     = useState(false);
  const [modal,       setModal]       = useState(null);
  const [btnLoad,     setBtnLoad]     = useState(false);

  useEffect(() => {
    if (!account || !callContract) return;
    setLoading(true);
    const load = async (contract) => {
      const count = await contract.getOptionsCount(account);
      const open = [], history = [];
      for (let i = Number(count) - 1; i >= 0; i--) {
        try {
          const id = await contract.addressToOptions(account, i);
          const r  = await contract.idToOption(id);
          const o  = { isAvailable: r[0], settled: r[1], partyL: r[2], partyS: r[3], openPosition: r[4], id: r[5], settlementType: r[6], initialSellerMargin: r[7], strikePrice: r[8], cost: r[9], quantity: r[10], expiry: r[11], troveSignature: r[12], troveDeadline: r[13] };
          if (o.settled) history.push(o); else open.push(o);
        } catch {}
      }
      return { open, history };
    };
    Promise.all([load(callContract), load(putContract)])
      .then(([c, p]) => {
        setCallOrders(c.open);    setPutOrders(p.open);
        setCallHistory(c.history); setPutHistory(p.history);
      })
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
      return (await putContract.settleOption(o.id, { value: Number(o.settlementType) === 0 ? o.quantity : 0n })).wait();
    }, 'Option settled.'),
  };

  const orders  = tab === 'call' ? callOrders  : putOrders;
  const history = tab === 'call' ? callHistory : putHistory;
  const isCall  = tab === 'call';

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex flex-col gap-1">
        <div className="flex gap-1">
          {['open','history'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`text-xs px-2 py-0.5 rounded font-display capitalize transition-colors ${view === v ? 'bg-surface text-text' : 'text-dim'}`}>{v}</button>
          ))}
          <span className="text-border mx-1">|</span>
          {['call','put'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2 py-0.5 rounded uppercase tracking-wider font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div>{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : view === 'history' ? (
          history.length === 0
            ? <div className="flex flex-col items-center justify-center h-24 gap-1">
                <span className="text-dim text-xs">No {tab} history</span>
                <span className="text-dim/50 text-[10px]">Settled options will appear here</span>
              </div>
            : history.map((o, i) => {
                const sp = fmt(o.strikePrice), qty = fmt(o.quantity), cost = fmt(o.cost);
                const isLong = o.partyS !== account;
                const finalPL = isCall
                  ? (isLong ? (Math.max(0, fmt(o.settledPrice || 0) - sp) - cost) * qty : (cost - Math.max(0, fmt(o.settledPrice || 0) - sp)) * qty)
                  : (isLong ? (Math.max(0, sp - fmt(o.settledPrice || 0)) - cost) * qty : (cost - Math.max(0, sp - fmt(o.settledPrice || 0))) * qty);
                return (
                  <div key={i} className="border-b border-border px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={isLong ? 'tag-call' : 'tag-put'}>{isLong ? 'Long' : 'Short'}</span>
                      <span className="font-mono text-xs text-dim">Strike ${sp.toLocaleString()}</span>
                      <span className="text-xs text-dim/50">Settled</span>
                    </div>
                    <span className={`font-mono text-xs font-semibold ${finalPL >= 0 ? 'text-accent' : 'text-red'}`}>
                      {finalPL >= 0 ? '+' : ''}{finalPL.toFixed(1)} MUSD
                    </span>
                  </div>
                );
              })
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-1">
            <span className="text-dim text-xs">No {tab} positions</span>
            <span className="text-dim/50 text-[10px]">Place or fill an order to get started</span>
          </div>
        ) : orders.map((o, i) => (
          <PositionRow key={i} o={o} isCall={isCall} account={account} btcPrice={btcPrice} onAction={setModal} />
        ))}
      </div>

      <ActionModal modal={modal} onClose={() => setModal(null)} onConfirm={actions[modal?.action]} loading={btnLoad} />
    </div>
  );
}
