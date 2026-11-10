import React, { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, ADDRESSES } from '../store';
import { explorerTx } from '../network.mjs';
import { parseTxError } from '../txUtils';
import { useNow } from '../useNow';
import { fmtDuration, lockRemaining, breakerActive, withdrawEstimate } from '../poolRules.mjs';


function TxToast({ msg, hash }) {
  return <div>{msg}{hash && <><br/><a href={explorerTx(useStore.getState().network, hash)} target="_blank" rel="noreferrer" className="text-accent text-xs underline">View on explorer ↗</a></>}</div>;
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
    poolTotalAssets, poolLocked, poolUtilisation, poolShareValue, poolParams, lockExpiry,
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

  const now      = useNow();
  const locked   = lockRemaining(lockExpiry, now);
  const breaker  = breakerActive(poolParams?.cbUntil, now);
  const feeBps   = poolParams?.withdrawalFeeBps ?? 0;
  const feeApplies = (poolParams?.openPoolOptions ?? 0) > 0 && feeBps > 0;
  const sv       = parseFloat(poolShareValue);
  const amt      = parseFloat(amount);
  const est      = amt > 0 && sv > 0 ? withdrawEstimate(amt, sv, feeBps, poolParams?.openPoolOptions ?? 0) : null;

  // Block what the contract would reject, and say why, instead of letting the wallet show a failed transaction.
  const blocked = tab === 'withdraw'
    ? (locked > 0 ? `Your deposit is locked for another ${fmtDuration(locked)}.` : null)
    : (breaker ? `Deposits are paused until ${new Date(poolParams.cbUntil * 1000).toLocaleTimeString()} after a fast price move.` : null);
  const canAct = amount && amt > 0 && !loading && poolContract && !blocked;

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
          {amount && amt > 0 && poolShareValue !== '—' && (
            <p className="text-xs text-dim">
              {tab === 'deposit'
                ? `≈ ${(amt / sv).toFixed(4)} yMUSD`
                : `≈ ${est.net.toFixed(4)} MUSD${est.fee > 0 ? ` (after a ${est.fee.toFixed(4)} MUSD exit fee)` : ''}`}
            </p>
          )}
          {blocked && <p className="text-xs text-yellow-500">{blocked}</p>}
          <button disabled={!canAct} onClick={tab === 'deposit' ? deposit : withdraw}
            className="w-full py-2.5 rounded-md font-display font-bold text-sm bg-accent/20 text-accent border border-accent/30 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2">
            {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Waiting…' : tab === 'deposit' ? 'Deposit MUSD' : 'Withdraw'}
          </button>
        </div>

        {poolParams && (
          <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-dim">Your deposit lock</span>
              <span className={`font-mono ${locked > 0 ? 'text-yellow-500' : 'text-text'}`}>{locked > 0 ? fmtDuration(locked) : 'unlocked'}</span></div>
            <div className="flex justify-between"><span className="text-dim">Exit fee now</span>
              <span className="font-mono text-text">{feeApplies ? `${(feeBps / 100).toFixed(2)}%` : '0% (no open options)'}</span></div>
            <div className="flex justify-between"><span className="text-dim">Open pool options</span>
              <span className="font-mono text-text">{poolParams.openPoolOptions}</span></div>
          </div>
        )}

        <p className="text-[10px] text-dim/60 leading-relaxed">
          Depositors earn yield from option premiums. yMUSD represents your share of the pool.
          {poolParams && ` New deposits are locked for ${fmtDuration(poolParams.depositLockSeconds)}, and leaving while options are open costs ${(feeBps / 100).toFixed(2)}%, which stays in the pool for the remaining depositors.`}
          {' '}Share value counts premium not yet earned as owed, so it rises as options expire unexercised. Withdrawals are instant up to available liquidity.
        </p>
      </div>
    </div>
  );
}
