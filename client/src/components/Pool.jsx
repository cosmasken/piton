import React, { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, ADDRESSES } from '../store';
import { parseTxError } from '../txUtils';

const EXPLORER = 'https://explorer.test.mezo.org/tx/';

function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={`${EXPLORER}${hash}`} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
}

function Stat({ label, value }) {
  return (
    <div className="bg-surface rounded-md px-3 py-2">
      <div className="text-[10px] text-dim uppercase tracking-wider">{label}</div>
      <div className="font-mono text-sm text-text mt-0.5">{value}</div>
    </div>
  );
}

export default function Pool() {
  const {
    poolContract, musdContract, chainId,
    musdBalance, ymusdBalance,
    poolTotalAssets, poolLocked, poolUtilisation, poolShareValue,
    refresh,
  } = useStore();

  const [tab,     setTab]     = useState('deposit');
  const [amount,  setAmount]  = useState('');
  const [loading, setLoading] = useState(false);

  const act = async (fn, msg) => {
    setLoading(true);
    try {
      const tx = await fn();
      refresh();
      toast.success(<TxToast msg={msg} hash={tx?.hash} />);
      setAmount('');
    } catch (e) { toast.error(parseTxError(e)); }
    finally { setLoading(false); }
  };

  const deposit = () => act(async () => {
    const poolAddr = ADDRESSES[chainId].pool;
    const amt = ethers.parseEther(amount);
    await (await musdContract.approve(poolAddr, amt)).wait();
    return (await poolContract.deposit(amt)).wait();
  }, 'Deposited!');

  const withdraw = () => act(async () => {
    return (await poolContract.withdraw(ethers.parseEther(amount))).wait();
  }, 'Withdrawn!');

  const canAct = amount && parseFloat(amount) > 0 && !loading && poolContract;

  return (
    <div className="panel flex flex-col overflow-hidden flex-1">
      <div className="panel-header">Pool</div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Total Assets" value={`${poolTotalAssets} MUSD`} />
          <Stat label="Utilisation"  value={`${poolUtilisation}%`} />
          <Stat label="Locked"       value={`${poolLocked} MUSD`} />
          <Stat label="Share Value"  value={`${poolShareValue} MUSD`} />
        </div>

        <div className="bg-surface rounded-md px-3 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-dim">Your MUSD</span>
            <span className="font-mono text-text">{musdBalance}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-dim">Your yMUSD</span>
            <span className="font-mono text-accent">{ymusdBalance}</span>
          </div>
        </div>

        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          <button onClick={() => setTab('deposit')}  className={`flex-1 py-2 transition-colors ${tab === 'deposit'  ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Deposit</button>
          <button onClick={() => setTab('withdraw')} className={`flex-1 py-2 transition-colors ${tab === 'withdraw' ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Withdraw</button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between mb-1">
            <label className="text-xs text-dim">{tab === 'deposit' ? 'MUSD to deposit' : 'yMUSD to burn'}</label>
            <button className="text-xs text-dim hover:text-accent transition-colors"
              onClick={() => setAmount(tab === 'deposit' ? musdBalance.replace(/,/g,'') : ymusdBalance.replace(/,/g,''))}>
              Max
            </button>
          </div>
          <input className="input-field" type="number" step="any" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} />
          {amount && parseFloat(amount) > 0 && poolShareValue !== '—' && (
            <p className="text-xs text-dim">
              {tab === 'deposit'
                ? `≈ ${(parseFloat(amount) / parseFloat(poolShareValue)).toFixed(4)} yMUSD`
                : `≈ ${(parseFloat(amount) * parseFloat(poolShareValue)).toFixed(4)} MUSD`}
            </p>
          )}
          <button disabled={!canAct} onClick={tab === 'deposit' ? deposit : withdraw}
            className="w-full py-2.5 rounded-md font-display font-bold text-sm bg-accent/20 text-accent border border-accent/30 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2">
            {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Waiting…' : tab === 'deposit' ? 'Deposit MUSD' : 'Withdraw'}
          </button>
        </div>

        <p className="text-[10px] text-dim/60 leading-relaxed">
          Depositors earn yield from option premiums. yMUSD represents your share of the pool.
          Withdrawals are instant up to available liquidity.
        </p>
      </div>
    </div>
  );
}
