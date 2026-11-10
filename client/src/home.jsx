import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from './store';
import { getNetwork, isLive, ZERO_ADDRESS, explorerAddress } from './network.mjs';
import NetworkToggle from './components/NetworkToggle';

const shortAddr = a => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Addr({ label, short, href }) {
  if (!href) return (
    <div className="flex justify-between items-center py-3 border-b border-border last:border-b-0 font-mono text-sm">
      <span className="text-dim font-body text-xs uppercase tracking-wider">{label}</span>
      <span className="text-yellow-500/90 font-body text-xs">{short}</span>
    </div>
  );
  return (
    <a className="flex justify-between items-center py-3 border-b border-border last:border-b-0 hover:text-accent transition-colors font-mono text-sm" href={href} target="_blank" rel="noreferrer">
      <span className="text-dim font-body text-xs uppercase tracking-wider">{label}</span>
      <span className="text-text">{short} ↗</span>
    </a>
  );
}

const STEPS = [
  {
    n: '1',
    tag: 'Liquidity',
    title: 'Fund the Pool',
    body: 'Deposit MUSD to receive yMUSD. Pool capital backs every option the protocol sells short and earns yield from premiums.',
  },
  {
    n: '2',
    tag: 'Traders',
    title: 'Buy or Sell',
    body: 'Longs set strike, expiry and premium — the pool auto-fills at Black-Scholes fair value. Manual shorts can post MUSD or use Trove margin.',
  },
  {
    n: '3',
    tag: 'Exercise',
    title: 'Settle Anytime',
    body: 'American-style. If the option is in the money before expiry, the long exercises and receives cash profit in MUSD — no BTC transfer.',
  },
  {
    n: '4',
    tag: 'Expiry',
    title: 'Unlock & Recycle',
    body: 'Expired options release collateral back to the pool. LPs withdraw instantly up to available liquidity, and performance fees apply to net yield.',
  },
];

const CONTRACT_ROWS = [
  ['OptionPool', 'pool'],
  ['yMUSD (LP token)', 'ymusd'],
  ['MUSD', 'musd'],
  ['Skip Oracle (BTC/USD)', 'oracle'],
];

export default function Home() {
  const navigate = useNavigate();
  const network = useStore(s => s.network);
  const net = getNetwork(network);
  const live = isLive(net);
  return (
    <div className="min-h-screen bg-bg text-text font-body">

      {/* nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="font-display font-bold text-xl text-accent tracking-tight">piton</div>
        <div className="hidden md:flex items-center gap-8 text-sm text-dim">
          <a href="#how" className="hover:text-text transition-colors">How it works</a>
          <a href="#pool" className="hover:text-text transition-colors">Liquidity</a>
          <a href="#contracts" className="hover:text-text transition-colors">Contracts</a>
          {net.faucetUrl && <a href={net.faucetUrl} target="_blank" rel="noreferrer" className="hover:text-text transition-colors">Faucet</a>}
        </div>
        <div className="flex items-center gap-3">
          <NetworkToggle />
          <button className="btn-primary text-sm" onClick={() => navigate('/dashboard')}>Launch App →</button>
        </div>
      </nav>

      {/* hero */}
      <section className="relative flex flex-col items-center text-center px-6 pt-24 pb-20 overflow-hidden">
        <div className="hero-glow" />
        <p className="text-xs tracking-widest uppercase text-dim mb-4 font-body">Bitcoin Options on Mezo</p>
        <h1 className="font-display font-extrabold text-5xl md:text-7xl leading-none mb-6">
          Bitcoin Options,<br /><span className="text-accent">Settled On-Chain.</span>
        </h1>
        <p className="max-w-xl text-dim text-base leading-relaxed mb-10">
          Trade American-style BTC calls and puts priced and cash-settled in <span className="text-text font-semibold">MUSD</span>. The Piton liquidity pool takes the other side — no order-book wait, no intermediaries, fully collateralised.
        </p>
        <div className="flex gap-4">
          <button className="btn-primary text-base px-6 py-3" onClick={() => navigate('/dashboard')}>Start Trading →</button>
          <a className="btn-ghost text-base px-6 py-3" href="#how">How it works</a>
        </div>

        {/* stats */}
        <div className="flex flex-wrap justify-center items-center gap-6 md:gap-8 mt-16 text-center">
          {[['American','Exercise Style'],['15m–14d','Expiry Range'],['MUSD','Cash Settlement'],['100%','Collateralised']].map(([v, l], i, arr) => (
            <React.Fragment key={l}>
              <div>
                <div className="font-display font-bold text-2xl text-accent">{v}</div>
                <div className="text-xs text-dim mt-1 uppercase tracking-wider">{l}</div>
              </div>
              {i < arr.length - 1 && <div className="hidden md:block w-px h-8 bg-border" />}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="bg-surface border-y border-border px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs tracking-widest uppercase text-dim mb-3">Protocol</p>
          <h2 className="font-display font-bold text-3xl mb-12">How Piton works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {STEPS.map(({ n, tag, title, body }) => (
              <div key={n} className="panel p-5 relative overflow-hidden">
                <div className="absolute top-3 right-4 font-display font-extrabold text-5xl text-border select-none">{n}</div>
                <div className="text-[10px] uppercase tracking-widest text-accent/70 mb-2 font-body">{tag}</div>
                <h3 className="font-display font-semibold text-base mb-2">{title}</h3>
                <p className="text-xs text-dim leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* liquidity pool */}
      <section id="pool" className="px-6 py-20">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-xs tracking-widest uppercase text-dim mb-3">Liquidity</p>
            <h2 className="font-display font-bold text-3xl mb-5">Earn from every option.</h2>
            <p className="text-dim text-sm leading-relaxed mb-6">
              The pool is the counterparty to option buyers. Deposit MUSD, receive <span className="text-text font-semibold">yMUSD</span>, and earn the premium on every pool-filled trade plus collateral that expires worthless.
            </p>
            <ul className="space-y-3 text-sm text-dim">
              {[
                ['Instant deposits & withdrawals', 'Withdraw anytime up to available (unlocked) liquidity.'],
                ['Utilisation-based exposure', 'Only capital backing live options is locked.'],
                ['2% premium fee · 15% performance fee', 'Protocol fee on premiums plus a performance fee on net pool yield.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="text-accent mt-0.5">▸</span>
                  <div>
                    <div className="text-text font-semibold text-sm">{t}</div>
                    <div className="text-xs text-dim mt-0.5">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn-primary mt-8" onClick={() => navigate('/dashboard')}>Provide Liquidity →</button>
          </div>

          <div className="panel p-6">
            <div className="flex items-center justify-between mb-6">
              <p className="font-display font-semibold text-sm">Pool mechanics</p>
              <span className="tag-call font-mono">yMUSD</span>
            </div>
            <div className="space-y-4">
              {[
                ['Deposit', 'MUSD → yMUSD shares'],
                ['Collateral', 'Locked per open pool short'],
                ['Yield', 'Premium + expired collateral'],
                ['Fees', '2% premium · 15% performance'],
                ['Settlement', 'Cash only, in MUSD'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center text-sm border-b border-border last:border-b-0 pb-3 last:pb-0">
                  <span className="text-dim">{k}</span>
                  <span className="font-mono text-xs text-text text-right">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-md border border-accent/20 bg-accent/5 px-4 py-3">
              <div className="text-xs font-display font-semibold text-accent mb-1">✦ Trove Margin</div>
              <p className="text-xs text-dim leading-relaxed">
                Short sellers can use Mezo Trove equity as margin instead of locking MUSD — no capital lockup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* contracts */}
      <section id="contracts" className="px-6 py-20 border-t border-border">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs tracking-widest uppercase text-dim mb-3">Deployed Contracts</p>
          <h2 className="font-display font-bold text-3xl mb-8">{net.chain.name} <span className="text-dim text-xl font-body font-normal">· Chain ID {net.chain.id}</span></h2>
          {!live && <p className="text-sm text-yellow-500/90 mb-4">Piton is not live on {net.label} yet. Mezo's own contracts are shown for reference.</p>}
          <div className="panel px-5">
            {CONTRACT_ROWS.map(([label, key]) => {
              const addr = net.addresses[key];
              const deployed = addr && addr.toLowerCase() !== ZERO_ADDRESS;
              return <Addr key={label} label={label}
                short={deployed ? shortAddr(addr) : 'Not deployed yet'}
                href={deployed ? explorerAddress(network, addr) : null} />;
            })}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-dim">
        <div className="font-display font-bold text-accent">piton</div>
        <span>{net.chain.name} · Chain ID {net.chain.id} · {live ? (net.isTestnet ? 'Unaudited — testnet only' : 'Unaudited') : 'Not live yet'}</span>
        <div className="flex gap-6">
          {net.faucetUrl && <a href={net.faucetUrl} target="_blank" rel="noreferrer" className="hover:text-accent transition-colors">Faucet ↗</a>}
          <a href="https://mezo.org/docs/developers/" target="_blank" rel="noreferrer" className="hover:text-accent transition-colors">Docs ↗</a>
        </div>
      </footer>
    </div>
  );
}
