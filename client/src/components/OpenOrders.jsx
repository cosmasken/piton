import React, { useState, useMemo } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useStore, STATUS, TYPE } from '../store';
import { useCountdown } from '../useCountdown';
import { parseTxError } from '../txUtils';
import Modal from './Modal';
import { SkeletonRow } from './Skeleton';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';
// Must match OptionPool.CALL_CAP_MULTIPLE and protocolFeeBps
const CALL_CAP_MULTIPLE = 3;
const PROTOCOL_FEE = 0.02;
const fmt = v => v == null ? 0 : parseFloat(ethers.formatEther(v));

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

function DepthView({ options }) {
  const map = {};
  options.forEach(o => {
    const k = Math.round(fmt(o.strike) / 1000) * 1000;
    const side = o.optionType === TYPE.CALL ? 'calls' : 'puts';
    map[k] = map[k] || { strike: k, calls: 0, puts: 0 };
    map[k][side] += fmt(o.quantity);
  });
  const data = Object.values(map).sort((a, b) => a.strike - b.strike)
    .map(d => ({ ...d, strike: `$${(d.strike/1000).toFixed(0)}k` }));
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

// Open short order (seller waiting) = an ask you can buy; open long order the pool didn't fill
// (buyer waiting) = a bid you can sell into via fillShort.
const isAsk = o => o.long === ethers.ZeroAddress && o.short !== ethers.ZeroAddress;
const isBid = o => o.short === ethers.ZeroAddress && o.long !== ethers.ZeroAddress;

/** MUSD a seller must lock to fill a bid, at the current spot (contract recomputes at fill time). */
function sellCollateral(o, spot) {
  const strike = fmt(o.strike), qty = fmt(o.quantity);
  return o.optionType === TYPE.CALL ? Math.max(0, (CALL_CAP_MULTIPLE * spot - strike) * qty) : strike * qty;
}

function OrderRow({ o, account, onFill }) {
  const exp     = useCountdown(o.expiry);
  const isCall  = o.optionType === TYPE.CALL;
  const isOpen  = o.status === STATUS.OPEN;
  const bid     = isBid(o);
  const mine    = bid ? o.long === account : o.short === account;
  const canFill = isOpen && !mine && exp !== 'Expired';

  return (
    <tr className="border-b border-border hover:bg-surface/50 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs">{exp}</td>
      <td className="px-4 py-2.5"><span className={isCall ? 'tag-call' : 'tag-put'}>{isCall ? 'Call' : 'Put'}</span></td>
      <td className="px-4 py-2.5 text-[10px] uppercase tracking-wider">
        <span className={bid ? 'text-accent' : 'text-red'} title={bid ? 'Buyer waiting — you sell' : 'Seller waiting — you buy'}>{bid ? 'Bid' : 'Ask'}</span>
      </td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.strike).toLocaleString()}</td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.premium).toFixed(2)}</td>
      <td className="px-4 py-2.5 font-mono text-xs">{fmt(o.quantity).toFixed(4)}</td>
      <td className="px-4 py-2.5">
        {canFill && (
          <button onClick={() => onFill(o)} className="text-accent text-xs font-display font-semibold hover:opacity-70">{bid ? 'Sell →' : 'Buy →'}</button>
        )}
      </td>
    </tr>
  );
}

const COLS = ['Expiry', 'Type', 'Side', 'Strike', 'Premium', 'Qty'];

export default function OpenOrders() {
  const { account, poolContract, musdContract, btcPrice, options, ordersLoading, refresh } = useStore();

  const [tab,       setTab]       = useState('call');
  const [view,      setView]      = useState('book');
  const [modal,     setModal]     = useState(null);
  const [btnLoad,   setBtnLoad]   = useState(false);
  const [sortCol,   setSortCol]   = useState('Strike');
  const [sortAsc,   setSortAsc]   = useState(true);
  const [minStrike, setMinStrike] = useState('');
  const [maxStrike, setMaxStrike] = useState('');

  const isCallTab = tab === 'call';

  // peer-to-peer book: open asks (short orders) and bids (long orders the pool didn't fill)
  const openOrders = useMemo(() => {
    let list = options.filter(o =>
      o.status === STATUS.OPEN &&
      (isAsk(o) || isBid(o)) &&
      (isCallTab ? o.optionType === TYPE.CALL : o.optionType === TYPE.PUT)
    );
    if (minStrike) list = list.filter(o => fmt(o.strike) >= parseFloat(minStrike));
    if (maxStrike) list = list.filter(o => fmt(o.strike) <= parseFloat(maxStrike));
    const key = { Expiry: 'expiry', Type: 'optionType', Side: 'long', Strike: 'strike', Premium: 'premium', Qty: 'quantity' }[sortCol];
    list.sort((a, b) => sortAsc ? (a[key] > b[key] ? 1 : -1) : (a[key] < b[key] ? 1 : -1));
    return list;
  }, [options, isCallTab, sortCol, sortAsc, minStrike, maxStrike]);

  const allOpen = useMemo(() => options.filter(o => o.status === STATUS.OPEN && (isAsk(o) || isBid(o))), [options]);

  const toggleSort = col => { if (sortCol === col) setSortAsc(a => !a); else { setSortCol(col); setSortAsc(true); } };

  const fillOrder = async () => {
    if (!modal) return;
    setBtnLoad(true);
    try {
      const poolAddr = await poolContract.getAddress();
      let tx;
      if (isBid(modal)) {
        // Selling into a bid: lock collateral. Calls get a 2% buffer because the contract recomputes
        // collateral from spot at fill time; it only pulls the exact amount.
        const need = sellCollateral(modal, btcPrice) * (modal.optionType === TYPE.CALL ? 1.02 : 1);
        await (await musdContract.approve(poolAddr, ethers.parseEther(need.toFixed(6)))).wait();
        tx = await (await poolContract.fillShort(modal.id)).wait();
      } else {
        await (await musdContract.approve(poolAddr, modal.premium)).wait();
        tx = await (await poolContract.fillLong(modal.id)).wait();
      }
      refresh();
      toast.success(<TxToast msg="Order filled." hash={tx?.hash} />);
      setModal(null);
    } catch (e) { toast.error(parseTxError(e)); }
    finally { setBtnLoad(false); }
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
          <DepthView options={allOpen} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {ordersLoading ? (
            <div>{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : openOrders.length === 0 ? (
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
                {openOrders.map((o, i) => <OrderRow key={i} o={o} account={account} onFill={setModal} />)}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && (
        <Modal title={`${isBid(modal) ? 'Sell' : 'Buy'} ${modal.optionType === TYPE.CALL ? 'Call' : 'Put'} — ${isBid(modal) ? 'Short' : 'Long'}`} onClose={() => setModal(null)}>
          <div className="space-y-1 bg-surface rounded-md px-3 py-3">
            <Row label="Strike"   value={`$${fmt(modal.strike).toLocaleString()}`} />
            <Row label="Quantity" value={`${fmt(modal.quantity).toFixed(4)} BTC`} />
            {isBid(modal) ? <>
              <Row label="You receive" value={`${(fmt(modal.premium) * (1 - PROTOCOL_FEE)).toFixed(2)} MUSD (premium − 2% fee)`} accent />
              <Row label="You lock"    value={`${sellCollateral(modal, btcPrice).toFixed(2)} MUSD collateral`} />
              <Row label="Max loss"    value={`${sellCollateral(modal, btcPrice).toFixed(2)} MUSD`} />
            </> : <Row label="Premium" value={`${fmt(modal.premium).toFixed(2)} MUSD`} />}
            <Row label="Settlement" value="Cash (MUSD)" />
            {btcPrice && <Row label="Spot" value={`$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />}
          </div>
          <p className="text-xs text-dim">{isBid(modal)
            ? 'You take the short side: keep the premium, and the buyer is paid from your collateral if the option ends in the money. Unused collateral returns at settlement or expiry.'
            : 'You pay the premium and receive cash profit if ITM at settlement.'}</p>
          {isBid(modal) && modal.optionType === TYPE.CALL && (
            <p className="text-[10px] text-dim">Call collateral is (3 × spot − strike) × qty, recomputed when your transaction lands; we approve a 2% buffer.</p>
          )}
          <div className="flex gap-3">
            <button onClick={() => setModal(null)} className="btn-ghost flex-1">Cancel</button>
            <button onClick={fillOrder} disabled={btnLoad}
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
