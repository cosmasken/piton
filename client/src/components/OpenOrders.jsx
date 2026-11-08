import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useStore } from '../store';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import Modal from './Modal';
import { SkeletonRow } from './Skeleton';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
const fmt = v => parseFloat(ethers.formatUnits(v, 18));
const COLS = ['Expiry', 'Side', 'Strike', 'Cost', 'Qty'];

function DepthView({ callOrders, putOrders }) {
  const bucket = (orders, side) => {
    const map = {};
    orders.forEach(o => {
      const k = Math.round(fmt(o.strikePrice) / 1000) * 1000;
      map[k] = (map[k] || 0) + fmt(o.quantity);
    });
    return Object.entries(map).map(([strike, qty]) => ({ strike: Number(strike), [side]: qty }));
  };
  const calls = bucket(callOrders, 'calls');
  const puts  = bucket(putOrders,  'puts');
  const strikes = [...new Set([...calls, ...puts].map(d => d.strike))].sort((a, b) => a - b);
  const data = strikes.map(s => ({
    strike: `$${(s/1000).toFixed(0)}k`,
    calls: calls.find(d => d.strike === s)?.calls || 0,
    puts:  puts.find(d => d.strike === s)?.puts  || 0,
  }));

  if (!data.length) return <div className="flex items-center justify-center h-full text-dim text-xs">No orders to display</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="strike" tick={{ fill: '#3a5a3a', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#3a5a3a', fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={v => v.toFixed(2)} />
        <Tooltip contentStyle={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 6, fontSize: 11 }}
          formatter={(v, name) => [v.toFixed(4) + ' BTC', name]} />
        <Bar dataKey="calls" fill="#00ff88" opacity={0.7} radius={[2,2,0,0]} />
        <Bar dataKey="puts"  fill="#ff4466" opacity={0.7} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function Row({ label, value, accent }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-dim">{label}</span>
      <span className={`font-mono text-xs ${accent ? 'text-accent' : 'text-text'}`}>{value}</span>
    </div>
  );
}

function OrderRow({ o, isCall, account, onFill }) {
  const exp   = useCountdown(o.expiry);
  const side  = o.openPosition === 0n || o.openPosition === 0 ? 'Long' : 'Short';
  const canFill = exp !== 'Expired' && o.partyL !== account && o.partyS !== account;
  const action  = side === 'Long' ? (isCall ? 'buyCall' : 'buyPut') : (isCall ? 'sellCall' : 'sellPut');
  return (
    <tr className="border-b border-border hover:bg-surface/50 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs">{exp}</td>
      <td className="px-4 py-2.5"><span className={side === 'Long' ? 'tag-call' : 'tag-put'}>{side}</span></td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.strikePrice).toLocaleString()}</td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.cost).toFixed(2)}</td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.quantity).toFixed(4)}</td>
      <td className="px-4 py-2.5">
        {canFill && (
          <button onClick={() => onFill({ order: o, isCall, action, settlType: 0 })}
            className="text-accent text-xs font-display font-semibold hover:opacity-70">Fill →</button>
        )}
      </td>
    </tr>
  );
}

export default function OpenOrders() {
  const { account, callContract, putContract, musdContract, btcPrice, callOrders, putOrders, ordersLoading, musdBalance, refresh } = useStore();

  const [tab,       setTab]       = useState('call');
  const [view,      setView]      = useState('book');
  const [modal,     setModal]     = useState(null);
  const [btnLoad,   setBtnLoad]   = useState(false);
  const [sortCol,   setSortCol]   = useState('Strike');
  const [sortAsc,   setSortAsc]   = useState(true);
  const [minStrike, setMinStrike] = useState('');
  const [maxStrike, setMaxStrike] = useState('');

  const isCall = tab === 'call';
  const raw    = isCall ? callOrders : putOrders;

  const orders = useMemo(() => {
    let list = raw.map(o => ({
      ...o,
      _strike: fmt(o.strikePrice), _cost: fmt(o.cost),
      _qty: fmt(o.quantity),       _expiry: Number(o.expiry),
      _side: o.openPosition === 0n || o.openPosition === 0 ? 'Long' : 'Short',
    }));
    if (minStrike) list = list.filter(o => o._strike >= parseFloat(minStrike));
    if (maxStrike) list = list.filter(o => o._strike <= parseFloat(maxStrike));
    const key = { Expiry: '_expiry', Side: '_side', Strike: '_strike', Cost: '_cost', Qty: '_qty' }[sortCol];
    list.sort((a, b) => sortAsc ? (a[key] > b[key] ? 1 : -1) : (a[key] < b[key] ? 1 : -1));
    return list;
  }, [raw, sortCol, sortAsc, minStrike, maxStrike]);

  const toggleSort = col => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };

  // Derived fill details for modal
  const fillDetails = useMemo(() => {
    if (!modal) return null;
    const o = modal.order;
    const cost = fmt(o.cost), strike = fmt(o.strikePrice), qty = fmt(o.quantity);
    const mv = btcPrice * qty;
    const isLong = modal.action.startsWith('buy');
    const collateral = isLong
      ? `${cost.toFixed(2)} MUSD (premium)`
      : modal.action === 'sellCall'
        ? (modal.settlType === 1 ? `${(mv * 0.67).toFixed(2)} MUSD` : `${qty.toFixed(4)} BTC`)
        : `${strike.toFixed(2)} MUSD`;
    const musd = parseFloat(musdBalance?.replace(/,/g, '') || '0');
    const insufficient = isLong && musd < cost;
    return { cost, strike, qty, collateral, insufficient };
  }, [modal, btcPrice, musdBalance]);

  const run = async (fn) => {
    setBtnLoad(true);
    try {
      const tx = await fn();
      refresh();
      toast.success(<TxToast msg="Order filled." hash={tx?.hash} />);
      setModal(null);
    } catch (e) { toast.error(parseTxError(e)); }
    finally { setBtnLoad(false); }
  };

  const actions = {
    buyCall:  () => run(async () => { await (await musdContract.approve(await callContract.getAddress(), modal.order.cost)).wait(); return (await callContract.buyToOpen(modal.order.id)).wait(); }),
    sellCall: () => run(async () => { const o = modal.order; if (modal.settlType === 1) { const margin = ethers.parseUnits((btcPrice * fmt(o.quantity) * 0.67).toFixed(6), 18); await (await musdContract.approve(await callContract.getAddress(), margin)).wait(); return (await callContract.sellToOpen(o.id, 1, margin, '0x', 0)).wait(); } return (await callContract.sellToOpen(o.id, 0, 0, '0x', 0, { value: o.quantity })).wait(); }),
    buyPut:   () => run(async () => { const o = modal.order; await (await musdContract.approve(await putContract.getAddress(), o.cost)).wait(); return (await putContract.buyToOpen(o.id, modal.settlType)).wait(); }),
    sellPut:  () => run(async () => { const o = modal.order; await (await musdContract.approve(await putContract.getAddress(), o.strikePrice)).wait(); return (await putContract.sellToOpen(o.id, o.strikePrice, '0x', 0)).wait(); }),
  };

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1 rounded uppercase tracking-wider font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
          <button onClick={() => setView(v => v === 'book' ? 'depth' : 'book')}
            className={`text-xs px-3 py-1 rounded font-display transition-colors ${view === 'depth' ? 'bg-surface text-text' : 'text-dim'}`}>Depth</button>
        </div>
        {view === 'book' && (
          <div className="flex items-center gap-1">
            <input className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-dim focus:outline-none focus:border-accent"
              placeholder="Min $" value={minStrike} onChange={e => setMinStrike(e.target.value)} />
            <span className="text-dim text-xs">–</span>
            <input className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-dim focus:outline-none focus:border-accent"
              placeholder="Max $" value={maxStrike} onChange={e => setMaxStrike(e.target.value)} />
          </div>
        )}
      </div>

      {view === 'depth' ? (
        <div className="flex-1 min-h-0 p-3">
          <DepthView callOrders={callOrders} putOrders={putOrders} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {ordersLoading ? (
            <div>{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 gap-1">
              <span className="text-dim text-xs">No open {tab} orders</span>
              <span className="text-dim/50 text-[10px]">Be the first to place one</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg">
                <tr className="border-b border-border">
                  {COLS.map(col => (
                    <th key={col} onClick={() => toggleSort(col)}
                      className="text-left px-4 py-2 text-[10px] uppercase tracking-wider text-dim cursor-pointer select-none hover:text-text transition-colors">
                      {col}{sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => <OrderRow key={i} o={o} isCall={isCall} account={account} onFill={setModal} />)}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && fillDetails && (
        <Modal title={`Fill ${modal.isCall ? 'Call' : 'Put'} — ${modal.action.startsWith('buy') ? 'Long' : 'Short'}`} onClose={() => setModal(null)}>
          <div className="space-y-1 bg-surface rounded-md px-3 py-3">
            <Row label="Strike"     value={`$${fillDetails.strike.toLocaleString()}`} />
            <Row label="Quantity"   value={`${fillDetails.qty.toFixed(4)} BTC`} />
            <Row label="Premium"    value={`${fillDetails.cost.toFixed(2)} MUSD`} />
            <Row label="You provide" value={fillDetails.collateral} />
            {btcPrice && <Row label="Spot price" value={`$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />}
          </div>

          {(modal.action === 'sellCall' || modal.action === 'buyPut') && (
            <div>
              <label className="block text-xs text-dim mb-1">Settlement type</label>
              <select className="input-field" value={modal.settlType} onChange={e => setModal(m => ({ ...m, settlType: Number(e.target.value) }))}>
                <option value={0}>BTC</option>
                <option value={1}>MUSD</option>
              </select>
            </div>
          )}

          {fillDetails.insufficient && (
            <p className="text-xs text-red bg-red/5 border border-red/20 rounded px-2 py-1.5">⚠ Insufficient MUSD balance</p>
          )}

          <p className="text-xs text-dim">Requires wallet approval + transaction.</p>
          <div className="flex gap-3">
            <button onClick={() => setModal(null)} className="btn-ghost flex-1">Cancel</button>
            <button onClick={actions[modal.action]} disabled={btnLoad || fillDetails.insufficient}
              className="btn-primary flex-1 disabled:opacity-50 flex items-center justify-center gap-2">
              {btnLoad && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
              {btnLoad ? 'Confirming…' : 'Confirm Fill'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
