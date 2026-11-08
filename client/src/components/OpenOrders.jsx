import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';
import { toast } from 'react-toastify';
import { useStore } from '../store';

function expiry(ts) {
  const exp = dayjs(Number(ts) * 1000), now = dayjs();
  if (exp.isBefore(now)) return 'Expired';
  const h = exp.diff(now, 'hour'), m = exp.diff(now, 'minute') % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const fmt = v => parseFloat(ethers.formatUnits(v, 18));

const COLS = ['Expiry', 'Side', 'Strike', 'Cost', 'Qty'];

export default function OpenOrders() {
  const { account, callContract, putContract, musdContract, btcPrice, callOrders, putOrders, ordersLoading, refresh } = useStore();

  const [tab,       setTab]       = useState('call');
  const [modal,     setModal]     = useState(null);
  const [btnLoad,   setBtnLoad]   = useState(false);
  const [sortCol,   setSortCol]   = useState('Strike');
  const [sortAsc,   setSortAsc]   = useState(true);
  const [minStrike, setMinStrike] = useState('');
  const [maxStrike, setMaxStrike] = useState('');

  const isCall = tab === 'call';
  const raw = isCall ? callOrders : putOrders;

  const orders = useMemo(() => {
    let list = raw.map(o => ({
      ...o,
      _strike: fmt(o.strikePrice),
      _cost:   fmt(o.cost),
      _qty:    fmt(o.quantity),
      _expiry: Number(o.expiry),
      _side:   o.openPosition === 0n || o.openPosition === 0 ? 'Long' : 'Short',
    }));
    if (minStrike) list = list.filter(o => o._strike >= parseFloat(minStrike));
    if (maxStrike) list = list.filter(o => o._strike <= parseFloat(maxStrike));
    const key = { Expiry: '_expiry', Side: '_side', Strike: '_strike', Cost: '_cost', Qty: '_qty' }[sortCol];
    list.sort((a, b) => sortAsc ? (a[key] > b[key] ? 1 : -1) : (a[key] < b[key] ? 1 : -1));
    return list;
  }, [raw, sortCol, sortAsc, minStrike, maxStrike]);

  const toggleSort = col => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };

  const run = async (fn) => {
    setBtnLoad(true);
    try { await fn(); refresh(); toast.success('Order filled.'); setModal(null); }
    catch (e) { toast.error(e?.reason || e?.message || 'Transaction failed.'); }
    finally { setBtnLoad(false); }
  };

  const actions = {
    buyCall:  () => run(async () => { await (await musdContract.approve(await callContract.getAddress(), modal.order.cost)).wait(); await (await callContract.buyToOpen(modal.order.id)).wait(); }),
    sellCall: () => run(async () => { const o = modal.order; if (modal.settlType === 1) { const margin = ethers.parseUnits((btcPrice * fmt(o.quantity) * 0.67).toFixed(6), 18); await (await musdContract.approve(await callContract.getAddress(), margin)).wait(); await (await callContract.sellToOpen(o.id, 1, margin, '0x', 0)).wait(); } else { await (await callContract.sellToOpen(o.id, 0, 0, '0x', 0, { value: o.quantity })).wait(); } }),
    buyPut:   () => run(async () => { const o = modal.order; await (await musdContract.approve(await putContract.getAddress(), o.cost)).wait(); await (await putContract.buyToOpen(o.id, modal.settlType)).wait(); }),
    sellPut:  () => run(async () => { const o = modal.order; await (await musdContract.approve(await putContract.getAddress(), o.strikePrice)).wait(); await (await putContract.sellToOpen(o.id, o.strikePrice, '0x', 0)).wait(); }),
  };

  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1 rounded uppercase tracking-wider font-display transition-colors ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>{t}</button>
          ))}
        </div>
        {/* strike filter */}
        <div className="flex items-center gap-1">
          <input className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-dim focus:outline-none focus:border-accent"
            placeholder="Min $" value={minStrike} onChange={e => setMinStrike(e.target.value)} />
          <span className="text-dim text-xs">–</span>
          <input className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono text-dim focus:outline-none focus:border-accent"
            placeholder="Max $" value={maxStrike} onChange={e => setMaxStrike(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {ordersLoading ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center h-16 text-dim text-xs">No open {tab} orders</div>
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
              {orders.map((o, i) => {
                const exp = expiry(o.expiry);
                const canFill = exp !== 'Expired' && o.partyL !== account && o.partyS !== account;
                const action = o._side === 'Long' ? (isCall ? 'buyCall' : 'buyPut') : (isCall ? 'sellCall' : 'sellPut');
                return (
                  <tr key={i} className="border-b border-border hover:bg-surface/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono">{exp}</td>
                    <td className="px-4 py-2.5"><span className={o._side === 'Long' ? 'tag-call' : 'tag-put'}>{o._side}</span></td>
                    <td className="px-4 py-2.5 font-mono">{o._strike.toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono">{o._cost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono">{o._qty.toFixed(4)}</td>
                    <td className="px-4 py-2.5">
                      {canFill && <button onClick={() => setModal({ order: o, isCall, action, settlType: 0 })} className="text-accent text-xs font-display font-semibold hover:opacity-70">Fill →</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="panel w-80 p-6 space-y-4">
            <p className="font-display font-semibold">Fill Order</p>
            <p className="text-sm text-dim">Taking <strong className="text-text">{modal.action.startsWith('buy') ? 'Long' : 'Short'}</strong> on this {modal.isCall ? 'call' : 'put'}.</p>
            {(modal.action === 'sellCall' || modal.action === 'buyPut') && (
              <div>
                <label className="block text-xs text-dim mb-1">Settlement Type</label>
                <select className="input-field" value={modal.settlType} onChange={e => setModal(m => ({ ...m, settlType: Number(e.target.value) }))}>
                  <option value={0}>BTC</option><option value={1}>MUSD</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={actions[modal.action]} disabled={btnLoad} className="btn-primary flex-1 disabled:opacity-50">{btnLoad ? '…' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
