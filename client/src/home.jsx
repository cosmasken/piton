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
          <a href="#testing" className="hover:text-text transition-colors">Testing</a>
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
        <a href="#testing" className="mt-4 text-xs text-yellow-400/90 hover:underline">Testnet beta, unaudited: read what to expect before testing ↓</a>

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


      {/* testing guide: what testers should expect on testnet */}
      <section id="testing" className="bg-surface border-y border-border px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs tracking-widest uppercase text-dim mb-3">Testnet beta</p>
          <h2 className="font-display font-bold text-3xl mb-3">Before you test: what to expect</h2>
          <p className="text-sm text-dim max-w-3xl mb-10">Piton is an <span className="text-text">unaudited beta on Mezo testnet</span>, test tokens only. Trades look small because the pool is small, not because sizes are fixed: you can type any size.</p>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="panel p-5">
              <h3 className="font-display font-semibold text-base mb-3">1 · Get set up</h3>
              <ol className="text-xs text-dim leading-relaxed space-y-2 list-decimal list-inside">
                <li>Add Mezo testnet (chain ID 31611, RPC rpc.test.mezo.org).</li>
                <li>Get test BTC (gas) and MEZO from the <a className="text-accent hover:underline" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer">faucet</a>.</li>
                <li>Borrow MUSD against your test BTC, or swap BTC → MUSD, at <a className="text-accent hover:underline" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>.</li>
                <li>Launch the app and connect.</li>
              </ol>
            </div>
            <div className="panel p-5">
              <h3 className="font-display font-semibold text-base mb-3">2 · What things cost</h3>
              <p className="text-xs text-dim mb-3">Chain prices are per 1 BTC of option; you pay price × size. At-the-money call, BTC $74k:</p>
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-dim"><th className="text-left font-normal pb-1">Expiry</th><th className="text-right font-normal pb-1">1 BTC</th><th className="text-right font-normal pb-1">0.01 BTC</th></tr></thead>
                <tbody>
                  {[['30 min', '$103', '$1.03'], ['1 day', '$716', '$7.16'], ['7 days', '$1,915', '$19.15'], ['14 days', '$2,728', '$27.28']].map(([e, a, b]) => (
                    <tr key={e} className="border-t border-border/60"><td className="py-1">{e}</td><td className="text-right">{a}</td><td className="text-right text-text">{b}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-dim mt-3">Default size on testnet is 0.001 BTC. Plus the 2% fee. Short options move 5–10% per block; that is normal.</p>
            </div>
            <div className="panel p-5">
              <h3 className="font-display font-semibold text-base mb-3">3 · How much the pool can sell</h3>
              <p className="text-xs text-dim mb-3">Every option is fully backed: a put locks ~$74k per BTC, a call ~$147k. One option may use at most 25% of the pool.</p>
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-dim"><th className="text-left font-normal pb-1">Pool</th><th className="text-right font-normal pb-1">Max put</th><th className="text-right font-normal pb-1">Max call</th></tr></thead>
                <tbody>
                  {[['2.4k MUSD', '0.008', '0.004'], ['10k MUSD', '0.034', '0.017'], ['50k MUSD', '0.17', '0.085']].map(([p, a, b]) => (
                    <tr key={p} className="border-t border-border/60"><td className="py-1">{p}</td><td className="text-right">{a} BTC</td><td className="text-right">{b} BTC</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-dim mt-3">The trade form shows the live limit. Too big? It offers the max size, or leave a limit bid for other traders.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <div className="panel p-5">
              <h3 className="font-display font-semibold text-base mb-3">Expiries, closing and liquidity</h3>
              <ul className="text-xs text-dim leading-relaxed space-y-1.5">
                <li>▸ 30-minute slots for the next few hours (testnet only), then daily 08:00 UTC and Fridays to 14 days. Shown in your local time.</li>
                <li>▸ The pool sells only with at least 15 minutes left.</li>
                <li>▸ Sell back to the pool any time (a bid a little under its value), exercise a winner, or turn on auto-exercise (last 5 min, 0.5%).</li>
                <li>▸ Pool deposits are locked for 1 hour; 0.25% withdrawal fee while options are open.</li>
              </ul>
            </div>
            <div className="panel p-5 border-yellow-700/40">
              <h3 className="font-display font-semibold text-base mb-3 text-yellow-400">Known limits of this beta</h3>
              <ul className="text-xs text-dim leading-relaxed space-y-1.5">
                <li>▸ Unaudited, testnet only.</li>
                <li>▸ One volatility for all strikes (Deribit DVOL, hourly).</li>
                <li>▸ Trading pauses if the BTC price is over 30 s old (2 min for exercise).</li>
                <li>▸ Keeper runs on one server: exercise yourself if in doubt.</li>
                <li>▸ Some trades come from our demo wallets to keep the book active.</li>
                <li>▸ Desktop first; the phone layout is not finished.</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-dim mt-6">Full guide: <a className="text-accent hover:underline" href="https://github.com/cosmasken/piton#testing-on-testnet-what-to-expect" target="_blank" rel="noreferrer">README · Testing on testnet</a></p>
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
                ['Deposits & withdrawals', '1-hour deposit lock; withdraw liquidity not backing live options (0.25% fee while options are open).'],
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
                Short sellers can borrow their margin as MUSD from their Mezo Trove in the same click: their BTC stays in the Trove. Unused margin returns at expiry.
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
