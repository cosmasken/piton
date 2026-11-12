import React, { useState } from 'react';
import { ethers } from 'ethers';
import { toast } from 'react-toastify';
import { useStore, ADDRESSES } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { explorerTx } from '../network.mjs';
import { parseTxError } from '../txUtils';
import { useNow } from '../useNow';
import Modal from './Modal';
import { lpPosition, poolExposure } from '../portfolio.mjs';
import { useTimes } from '../useTimes';
import { getNetwork } from '../network.mjs';
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

function PoolDetails({ params: p, stats, onClose }) {
  const yieldNet = p ? p.premiumsEarned - p.unearnedPremium - p.settlementsPaid : null;
  const m = v => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const pct = bps => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
  return (
    <Modal title="How the pool works" onClose={onClose}>
      <div className="space-y-3 text-xs text-dim leading-relaxed max-h-[70vh] overflow-y-auto pr-1">
        <p><span className="text-text">You are the seller.</span> Depositors' MUSD backs the options the pool sells. You earn the premiums buyers pay. When an option finishes in the money, the pool pays the buyer, up to the collateral locked for that option.</p>
        <p><span className="text-text">Where the yield comes from:</span> premium on options that expire worthless, plus Mezo's MUSD savings rate on spare MUSD that isn't backing any option (at most {p?.investCapBps != null ? p.investCapBps / 100 : 50}% of it; collateral for live options always stays in the pool). <span className="text-text">Where the risk comes from:</span> a big BTC move against the options the pool has sold can cost more than the premiums collected, and you can lose part of your deposit.</p>
        <p><span className="text-text">Share price.</span> yMUSD is priced on net asset value: pool assets minus what open options may owe. Premium for options still open counts as owed until they expire, so joining right before expiry doesn't capture it.</p>
        {p && (
          <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs">
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">Track record</p>
            <div className="flex justify-between"><span>Premiums earned (all time)</span><span className="font-mono text-text">{m(p.premiumsEarned)} MUSD</span></div>
            <div className="flex justify-between"><span>Paid out to buyers</span><span className="font-mono text-text">{m(p.settlementsPaid)} MUSD</span></div>
            <div className="flex justify-between"><span>Still unearned (open options)</span><span className="font-mono text-text">{m(p.unearnedPremium)} MUSD</span></div>
            <div className="flex justify-between"><span>Net earned so far</span><span className={`font-mono ${yieldNet >= 0 ? 'text-accent' : 'text-red'}`}>{m(yieldNet)} MUSD</span></div>
            <div className="flex justify-between"><span>Performance fees paid</span><span className="font-mono text-text">{m(p.performanceFeesPaid)} MUSD</span></div>
            {p.invested != null && <>
              <div className="flex justify-between"><span>Spare MUSD in Mezo savings (sMUSD)</span><span className="font-mono text-text">{m(p.invested)} MUSD</span></div>
              <div className="flex justify-between"><span>Savings yield earned (all time)</span><span className="font-mono text-accent">{m(p.savingsYield)} MUSD</span></div>
            </>}
          </div>
        )}
        {p && (
          <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs">
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">Rules, enforced on-chain</p>
            <div className="flex justify-between"><span>Price volatility (mid / ask)</span><span className="font-mono text-text">{(p.iv * 100).toFixed(1)}% / {(p.askIv * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Max pool utilisation</span><span className="font-mono text-text">{pct(p.maxUtilisationBps)}</span></div>
            <div className="flex justify-between"><span>Max share of pool in one option</span><span className="font-mono text-text">{pct(p.maxOptionExposureBps)}</span></div>
            <div className="flex justify-between"><span>Strikes sold within</span><span className="font-mono text-text">±{pct(p.strikeDistanceBps)} of spot</span></div>
            <div className="flex justify-between"><span>Minimum time left to sell</span><span className="font-mono text-text">{fmtDuration(p.minPoolExpiry)}</span></div>
            <div className="flex justify-between"><span>Deposit lock</span><span className="font-mono text-text">{fmtDuration(p.depositLockSeconds)}</span></div>
            <div className="flex justify-between"><span>Exit fee while options are open</span><span className="font-mono text-text">{pct(p.withdrawalFeeBps)} (stays in the pool)</span></div>
            <div className="flex justify-between"><span>Fees to the protocol</span><span className="font-mono text-text">2% of premiums, 15% of net yield</span></div>
          </div>
        )}
        <p>Circuit breaker: a fast price move pauses new sales and deposits for a while; withdrawals, exercising and refunds always work. Contracts are unaudited testnet code.</p>
      </div>
    </Modal>
  );
}

const nf = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** How much of the pool is tied up backing options, against the limit at which it stops selling. */
function UtilGauge({ p, locked, onExposure }) {
  const used = p.utilisationBps / 100, max = p.maxUtilisationBps / 100;
  const tone = used >= max ? 'bg-red' : used >= max * 0.75 ? 'bg-yellow-500' : 'bg-accent';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-dim">
        <span>Utilisation <span className="font-mono text-text">{used.toFixed(1)}%</span> · locked <span className="font-mono text-text">{locked}</span> MUSD</span>
        <button type="button" onClick={onExposure} className="text-accent hover:opacity-70">Exposure ›</button>
      </div>
      <div className="relative h-2 rounded bg-surface overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label="Pool utilisation">
        <div className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${Math.min(100, used)}%` }} />
        <div className="absolute inset-y-0 border-l border-dashed border-text/60" style={{ left: `${max}%` }} title={`The pool stops selling at ${max}%`} />
      </div>
      <p className="text-[10px] text-dim">The pool stops selling at {max}% · one option may use at most {p.maxOptionExposureBps / 100}% of the pool</p>
      {p.invested > 0 && (
        <p className="text-[10px] text-dim" title="Spare pool MUSD (not backing any option) is held in Mezo's MUSD Savings Rate and comes back automatically when the pool needs it. Collateral for live options always stays in the pool.">
          Earning Mezo savings rate: <span className="font-mono text-accent">{nf(p.invested)}</span> MUSD in sMUSD
          {p.savingsYield > 0 && <> · yield so far <span className="font-mono text-accent">+{nf(p.savingsYield)}</span></>}
        </p>
      )}
    </div>
  );
}

/** The connected wallet's share of the pool: value, deposits, withdrawals and P&L (deposit history from the subgraph). */
function YourPosition({ shares, shareValue, history, account, p, musdBalance }) {
  if (!account) return null;
  const lp = lpPosition(history?.account || {}, shares, shareValue, p ? p.totalAssets / (shareValue || 1) : 0);
  return (
    <div className="bg-surface rounded-md px-3 py-2 space-y-1 text-xs">
      <div className="flex justify-between"><span className="text-dim">Your MUSD</span><span className="font-mono text-text">{musdBalance}</span></div>
      <div className="flex justify-between"><span className="text-dim">Your pool share</span><span className="font-mono text-accent">{nf(lp.value)} MUSD <span className="text-dim">({nf(lp.sharePct, 1)}%)</span></span></div>
      {history?.account && <>
        <div className="flex justify-between"><span className="text-dim">Deposited / withdrawn</span><span className="font-mono text-text">{nf(lp.deposited)} / {nf(lp.withdrawn)}</span></div>
        <div className="flex justify-between"><span className="text-dim">Your pool P&L</span><span className={`font-mono ${lp.pnl >= 0 ? 'text-accent' : 'text-red'}`}>{lp.pnl >= 0 ? '+' : ''}{nf(lp.pnl)} MUSD</span></div>
      </>}
    </div>
  );
}

/** What the pool has sold and how much collateral each expiry and strike ties up. */
function ExposureModal({ options, p, network, onClose }) {
  const now = Math.floor(Date.now() / 1000);
  const times = useTimes();
  const x = poolExposure(options, getNetwork(network).addresses.pool, now);
  const exps = Object.entries(x.byExpiry).sort((a, b) => a[0] - b[0]);
  const strikes = Object.entries(x.byStrike).sort((a, b) => a[0] - b[0]);
  const max = Math.max(0, ...strikes.map(([, v]) => v.collateral));
  return (
    <Modal title="Pool exposure" onClose={onClose} width="w-[30rem]">
      <div className="space-y-3 text-xs">
        <p className="text-dim">Live options the pool has sold, and the collateral they lock ({nf(x.collateral)} MUSD of {nf(p?.totalAssets)} in the pool). The pool pays out from this collateral if they end in the money.</p>
        {!exps.length ? <p className="text-dim">The pool has no open options right now.</p> : <>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">By expiry</p>
            <table className="w-full font-mono"><tbody>
              {exps.map(([t, v]) => <tr key={t} className="border-b border-border/50"><td className="py-1">{times.full(Number(t))}</td><td className="text-right">{v.count} options</td><td className="text-right">{nf(v.qty, 4)} BTC</td><td className="text-right">{nf(v.collateral)} MUSD</td></tr>)}
            </tbody></table>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-dim mb-1">By strike (collateral)</p>
            {strikes.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 py-0.5">
                <span className="font-mono w-16 text-right">{Number(k).toLocaleString()}</span>
                <div className="flex-1 h-2 bg-surface rounded overflow-hidden"><div className="h-full bg-accent/60" style={{ width: `${max ? v.collateral / max * 100 : 0}%` }} /></div>
                <span className="font-mono w-36 text-right text-dim">{v.call > 0 ? `C ${nf(v.call, 4)} ` : ''}{v.put > 0 ? `P ${nf(v.put, 4)}` : ''}</span>
              </div>
            ))}
          </div>
        </>}
      </div>
    </Modal>
  );
}

export default function Pool() {
  const {
    poolContract, musdContract, chainId,
    musdBalance, ymusdBalance,
    poolTotalAssets, poolLocked, poolUtilisation, poolShareValue, poolParams, lockExpiry, musdRaw, ymusdRaw,
    refresh, history, options, account, network,
  } = useStore(useShallow(s => ({ history: s.history, options: s.options, account: s.account, network: s.network, poolContract: s.poolContract, musdContract: s.musdContract, chainId: s.chainId, musdBalance: s.musdBalance, ymusdBalance: s.ymusdBalance, poolTotalAssets: s.poolTotalAssets, poolLocked: s.poolLocked, poolUtilisation: s.poolUtilisation, poolShareValue: s.poolShareValue, poolParams: s.poolParams, lockExpiry: s.lockExpiry, musdRaw: s.musdRaw, ymusdRaw: s.ymusdRaw, refresh: s.refresh })));

  const times = useTimes();
  const [tab,     setTab]     = useState('deposit');
  const [amount,  setAmount]  = useState('');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(false);
  const [exposure, setExposure] = useState(false);

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
    ? (locked > 0 ? `Your deposit is locked for another ${fmtDuration(locked)}.`
      : ymusdBalance !== '—' && amt > parseFloat(ymusdRaw) ? `You only have ${ymusdBalance} yMUSD.` : null)
    : (breaker ? `Deposits are paused until ${times.clock(poolParams.cbUntil)} after a fast price move.`
      : musdBalance !== '—' && amt > parseFloat(musdRaw) ? `You only have ${musdBalance} MUSD in this wallet.` : null);
  const canAct = amount && amt > 0 && !loading && poolContract && !blocked;

  return (
    <div className="panel flex flex-col overflow-hidden flex-1">
      <div className="panel-header flex items-center justify-between"><span>Pool</span><button type="button" onClick={() => setDetails(true)} className="normal-case tracking-normal text-accent text-xs hover:opacity-70">How it works ›</button></div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Total Assets" value={`${poolTotalAssets} MUSD`} />
          <Stat label="Share Value"  value={`${poolShareValue} MUSD`} />
        </div>

        {poolParams && <UtilGauge p={poolParams} locked={poolLocked} onExposure={() => setExposure(true)} />}

        <YourPosition shares={parseFloat(ymusdRaw) || 0} shareValue={parseFloat(poolShareValue)} history={history} account={account} p={poolParams} musdBalance={musdBalance} />

        <div className="flex rounded-md overflow-hidden border border-border text-xs font-display font-semibold">
          <button onClick={() => setTab('deposit')}  className={`flex-1 py-2 transition-colors ${tab === 'deposit'  ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Deposit</button>
          <button onClick={() => setTab('withdraw')} className={`flex-1 py-2 transition-colors ${tab === 'withdraw' ? 'bg-accent/10 text-accent' : 'text-dim'}`}>Withdraw</button>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between mb-1">
            <label className="text-xs text-dim">{tab === 'deposit' ? 'MUSD to deposit' : 'yMUSD to burn'}</label>
            <button className="text-xs text-dim hover:text-accent transition-colors"
              onClick={() => setAmount(tab === 'deposit' ? musdRaw : ymusdRaw)}>
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
      {exposure && <ExposureModal options={options} p={poolParams} network={network} onClose={() => setExposure(false)} />}
      {details && <PoolDetails params={poolParams} stats={{ poolTotalAssets, poolLocked, poolUtilisation, poolShareValue }} onClose={() => setDetails(false)} />}
    </div>
  );
}
