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
  const exp = dayjs(Number(ts) * 1000), now = dayjs();
  if (exp.isBefore(now)) return 'Expired';
  const h = exp.diff(now, 'hour'), m = exp.diff(now, 'minute') % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const fmt = v => parseFloat(ethers.formatUnits(v, 18));

export default function YourOrders({ provider, signer, account, callContract, putContract, onRefresh, tick }) {
  const [callOrders, setCallOrders] = useState([]);
  const [putOrders,  setPutOrders]  = useState([]);
  const [tab,        setTab]        = useState('call');
  const [mv,         setMv]         = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);
  const [btnLoad,    setBtnLoad]    = useState(false);

  useEffect(() => {
    if (!account) return;
    (async () => {
      try {
        try { setMv(parseFloat(ethers.formatUnits(await callContract.getMarketValue(), 18))); }
        catch { const { price } = await (await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')).json(); setMv(parseFloat(price)); }

        const load = async (contract, setter) => {
          const count = await contract.getOptionsCount(account);
          const orders = [];
          for (let i = Number(count) - 1; i >= 0; i--) {
            try { const id = await contract.addressToOptions(account, i); const o = await contract.idToOption(id); if (!o.settled) orders.push(o); } catch {}
          }
          setter(orders);
        };
        await Promise.all([load(callContract, setCallOrders), load(putContract, setPutOrders)]);
      } finally { setLoading(false); }
    })();
  }, [account, callContract, putContract, tick]);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const run = async (fn, msg) => {
    setBtnLoad(true);
    try { await fn(); onRefresh(); toast.success(msg); setModal(null); }
    catch (e) { toast.error(e?.reason || e?.message || 'Transaction failed.'); }
    finally { setBtnLoad(false); }
  };

  const actions = {
    closeCall:  () => run(async () => { await (await callContract.closeOption(modal.order.id)).wait(); }, 'Order closed.'),
    refundCall: () => run(async () => { await (await callContract.refundExpired(modal.order.id)).wait(); }, 'Escrow refunded.'),
    settleCall: () => run(async () => { const o = modal.order; if (Number(o.settlementType) === 0) { const musd = await getMusd(); await (await musd.approve(await callContract.getAddress(), o.strikePrice)).wait(); } await (await callContract.settleOption(o.id)).wait(); }, 'Option settled.'),
    closePut:   () => run(async () => { await (await putContract.closeOption(modal.order.id)).wait(); }, 'Order closed.'),
    refundPut:  () => run(async () => { await (await putContract.refundExpired(modal.order.id)).wait(); }, 'Escrow refunded.'),
    settlePut:  () => run(async () => { const o = modal.order; await (await putContract.settleOption(o.id, { value: Number(o.settlementType) === 0 ? o.quantity : 0n })).wait(); }, 'Option settled.'),
  };

  const orders = tab === 'call' ? callOrders : putOrders;
  const isCall = tab === 'call';

  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-header flex items-center justify-between">
        <span>Your Positions</span>
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
          <div className="flex items-center justify-center h-20 text-dim text-xs">No {tab} positions</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim border-b border-border">
                {['Expiry','Side','P/L',''].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-body font-medium tracking-wider uppercase text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const qty = fmt(o.quantity), sp = fmt(o.strikePrice), c = fmt(o.cost);
                const mval = mv * qty, exp = expiry(o.expiry);
                const pos = o.partyS === account ? 'Short' : 'Long';
                const PL = !o.isAvailable && exp !== 'Expired'
                  ? (isCall ? (pos === 'Long' ? mval - sp - c : c - Math.max(0, mval - sp)) : (pos === 'Long' ? sp - mval - c : c - Math.max(0, sp - mval)))
                  : null;

                let action = null;
                if (o.isAvailable) action = isCall ? 'closeCall' : 'closePut';
                else if (exp === 'Expired') action = isCall ? 'refundCall' : 'refundPut';
                else if (pos === 'Long') action = isCall ? 'settleCall' : 'settlePut';

                return (
                  <tr key={i} className="border-b border-border hover:bg-surface/50 transition-colors fade-in">
                    <td className="px-4 py-2.5 font-mono">{exp}</td>
                    <td className="px-4 py-2.5">
                      <span className={pos === 'Long' ? 'tag-call' : 'tag-put'}>{pos}</span>
                    </td>
                    <td className={`px-4 py-2.5 font-mono ${PL === null ? 'text-dim' : PL > 0 ? 'text-accent' : 'text-red'}`}>
                      {PL === null ? '—' : (PL > 0 ? '+' : '') + PL.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5">
                      {action && (
                        <button
                          onClick={() => setModal({ order: o, action })}
                          className={`text-xs font-display font-semibold hover:opacity-70 transition-opacity ${action.startsWith('settle') ? 'text-accent' : 'text-dim'}`}
                        >
                          {action.startsWith('settle') ? 'Settle →' : action.startsWith('close') ? 'Close' : 'Refund'}
                        </button>
                      )}
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
            <p className="font-display font-semibold text-text">Confirm</p>
            <p className="text-sm text-dim font-body">
              {modal.action.startsWith('settle') ? `Settle ${isCall ? 'call' : 'put'} — receive payout.` :
               modal.action.startsWith('close')  ? 'Refund escrowed collateral.' :
               'Reclaim expired escrow.'}
            </p>
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
