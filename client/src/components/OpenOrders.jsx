import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';
import { toast } from 'react-toastify';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

function expiry(ts) {
  const exp = dayjs(Number(ts) * 1000);
  const now = dayjs();
  if (exp.isBefore(now)) return 'Expired';
  const h = exp.diff(now, 'hour');
  const m = exp.diff(now, 'minute') % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const fmt = v => parseFloat(ethers.formatUnits(v, 18));

export default function OpenOrders({ provider, signer, account, callContract, putContract, onRefresh, tick }) {
  const [callOrders, setCallOrders] = useState([]);
  const [putOrders,  setPutOrders]  = useState([]);
  const [tab,        setTab]        = useState('call');
  const [mv,         setMv]         = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);
  const [btnLoad,    setBtnLoad]    = useState(false);

  useEffect(() => {
    if (!callContract) return;
    (async () => {
      try {
        try {
          const rawMv = await callContract.getMarketValue();
          setMv(parseFloat(ethers.formatUnits(rawMv, 18)));
        } catch {
          const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json();
          setMv(parseFloat(price));
        }
        const load = async (contract, setter) => {
          const total = await contract.uniqueId();
          const orders = [];
          for (let i = 1; i < Number(total); i++) {
            try { const o = await contract.idToOption(i); if (o.isAvailable) orders.push(o); } catch {}
          }
          setter(orders);
        };
        await Promise.all([load(callContract, setCallOrders), load(putContract, setPutOrders)]);
      } finally { setLoading(false); }
    })();
  }, [callContract, putContract, tick]);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const run = async (fn) => {
    setBtnLoad(true);
    try { await fn(); onRefresh(); toast.success('Order filled.'); setModal(null); }
    catch (e) { toast.error(e?.reason || e?.message || 'Transaction failed.'); }
    finally { setBtnLoad(false); }
  };

  const actions = {
    buyCall:  () => run(async () => { const musd = await getMusd(); await (await musd.approve(await callContract.getAddress(), modal.order.cost)).wait(); await (await callContract.buyToOpen(modal.order.id)).wait(); }),
    sellCall: () => run(async () => { const musd = await getMusd(); const o = modal.order; if (modal.settlType === 1) { const margin = ethers.parseUnits((mv * fmt(o.quantity) * 0.67).toFixed(6), 18); await (await musd.approve(await callContract.getAddress(), margin)).wait(); await (await callContract.sellToOpen(o.id, 1, margin, '0x', 0)).wait(); } else { await (await callContract.sellToOpen(o.id, 0, 0, '0x', 0, { value: o.quantity })).wait(); } }),
    buyPut:   () => run(async () => { const musd = await getMusd(); const o = modal.order; await (await musd.approve(await putContract.getAddress(), o.cost)).wait(); await (await putContract.buyToOpen(o.id, modal.settlType)).wait(); }),
    sellPut:  () => run(async () => { const musd = await getMusd(); const o = modal.order; await (await musd.approve(await putContract.getAddress(), o.strikePrice)).wait(); await (await putContract.sellToOpen(o.id, o.strikePrice, '0x', 0)).wait(); }),
  };

  const orders = tab === 'call' ? callOrders : putOrders;
  const isCall = tab === 'call';

  return (
    <div className="panel flex flex-col overflow-hidden col-span-1">
      <div className="panel-header flex items-center justify-between">
        <span>Open Orders</span>
        <div className="flex gap-1">
          {['call','put'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1 rounded transition-colors uppercase tracking-wider font-display ${tab === t ? 'bg-surface text-text' : 'text-dim'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-20 text-dim text-xs">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-dim text-xs">No open {tab} orders</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim border-b border-border">
                {['Expiry','Side','Strike','Cost','Qty',''].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-body font-medium tracking-wider uppercase text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const exp = expiry(o.expiry);
                const openPos = o.openPosition === 0n || o.openPosition === 0 ? 'Long' : 'Short';
                const action = openPos === 'Long' ? (isCall ? 'buyCall' : 'buyPut') : (isCall ? 'sellCall' : 'sellPut');
                const canFill = exp !== 'Expired' && o.partyL !== account && o.partyS !== account;
                return (
                  <tr key={i} className="border-b border-border hover:bg-surface/50 transition-colors fade-in">
                    <td className="px-4 py-2.5 font-mono">{exp}</td>
                    <td className="px-4 py-2.5">
                      <span className={openPos === 'Long' ? 'tag-call' : 'tag-put'}>{openPos}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">{fmt(o.strikePrice).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono">{fmt(o.cost).toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono">{fmt(o.quantity).toFixed(4)}</td>
                    <td className="px-4 py-2.5">
                      {canFill && (
                        <button
                          onClick={() => setModal({ order: o, isCall, action, settlType: 0 })}
                          className="text-accent text-xs font-display font-semibold hover:opacity-70 transition-opacity"
                        >Fill →</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Fill modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="panel w-80 p-6 space-y-4">
            <p className="font-display font-semibold text-text">Fill Order</p>
            <p className="text-sm text-dim font-body">
              Taking <strong className="text-text">{modal.action.startsWith('buy') ? 'Long' : 'Short'}</strong> on this {modal.isCall ? 'call' : 'put'}.
            </p>
            {(modal.action === 'sellCall' || modal.action === 'buyPut') && (
              <div>
                <label className="block text-xs text-dim mb-1">Settlement Type</label>
                <select
                  className="input-field"
                  value={modal.settlType}
                  onChange={e => setModal(m => ({ ...m, settlType: Number(e.target.value) }))}
                >
                  <option value={0}>BTC</option>
                  <option value={1}>MUSD</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={actions[modal.action]} disabled={btnLoad} className="btn-primary flex-1 disabled:opacity-50">
                {btnLoad ? '…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
