import React from 'react';
import { useNavigate } from 'react-router-dom';

function Addr({ label, short, href }) {
  return (
    <a className="flex justify-between items-center py-3 border-b border-border hover:text-accent transition-colors font-mono text-sm" href={href} target="_blank" rel="noreferrer">
      <span className="text-dim font-body text-xs uppercase tracking-wider">{label}</span>
      <span className="text-text">{short} ↗</span>
    </a>
  );
}

export default function Home() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-bg text-text font-body">

      {/* nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="font-display font-bold text-xl text-accent tracking-tight">piton</div>
        <div className="hidden md:flex items-center gap-8 text-sm text-dim">
          <a href="#how" className="hover:text-text transition-colors">How it works</a>
          <a href="#contracts" className="hover:text-text transition-colors">Contracts</a>
          <a href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer" className="hover:text-text transition-colors">Faucet</a>
        </div>
        <button className="btn-primary text-sm" onClick={() => navigate('/dashboard')}>Launch App →</button>
      </nav>

      {/* hero */}
      <section className="relative flex flex-col items-center text-center px-6 pt-24 pb-20 overflow-hidden">
        <div className="hero-glow" />
        <p className="text-xs tracking-widest uppercase text-dim mb-4 font-body">Bitcoin Options on Mezo</p>
        <h1 className="font-display font-extrabold text-5xl md:text-7xl leading-none mb-6">
          Bitcoin Options,<br /><span className="text-accent">Settled On-Chain.</span>
        </h1>
        <p className="max-w-xl text-dim text-base leading-relaxed mb-10">
          Trade American-style BTC call &amp; put options priced in <span className="text-text font-semibold">MUSD</span> — Mezo's Bitcoin-backed stablecoin. No intermediaries. No custody. Fully collateralised.
        </p>
        <div className="flex gap-4">
          <button className="btn-primary text-base px-6 py-3" onClick={() => navigate('/dashboard')}>Start Trading →</button>
          <a className="btn-ghost text-base px-6 py-3" href="#how">How it works</a>
        </div>

        {/* stats */}
        <div className="flex items-center gap-8 mt-16 text-center">
          {[['48h','Max Expiry'],['2/3','Min Margin'],['0%','Platform Fee'],['BTC + MUSD','Settlement']].map(([v, l], i, arr) => (
            <React.Fragment key={l}>
              <div>
                <div className="font-display font-bold text-2xl text-accent">{v}</div>
                <div className="text-xs text-dim mt-1 uppercase tracking-wider">{l}</div>
              </div>
              {i < arr.length - 1 && <div className="w-px h-8 bg-border" />}
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
            {[
              ['1','Place an Order','Set strike, premium, quantity. Long pays MUSD premium. Short posts BTC or 2/3 MUSD — or Trove equity.'],
              ['2','Fill from the Book','Any wallet takes the opposite side directly on-chain. Pure OTC peer-to-peer.'],
              ['3','Settle Anytime','American-style — exercise before expiry. Settle in BTC or MUSD. Skip oracle updates every block.'],
              ['4','Reclaim Collateral','Expired options release collateral to the short. No liquidations, no funding rates.'],
            ].map(([n, title, body]) => (
              <div key={n} className="panel p-5 relative overflow-hidden">
                <div className="absolute top-3 right-4 font-display font-extrabold text-5xl text-border select-none">{n}</div>
                <div className="font-display font-bold text-accent text-sm mb-2">{n}</div>
                <h3 className="font-display font-semibold text-base mb-2">{title}</h3>
                <p className="text-xs text-dim leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* contracts */}
      <section id="contracts" className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs tracking-widest uppercase text-dim mb-3">Deployed Contracts</p>
          <h2 className="font-display font-bold text-3xl mb-8">Mezo Matsnet <span className="text-dim text-xl font-body font-normal">· Chain ID 31611</span></h2>
          <div className="panel px-5">
            <Addr label="CallOption"            short="0xd24f…Db7" href="https://explorer.test.mezo.org/address/0xd24fbb05E888aD3F22bEC8323D6D164Ec49bDDb7" />
            <Addr label="PutOption"             short="0x5c3b…416" href="https://explorer.test.mezo.org/address/0x5c3b1e87668DEF8909500640099068CE20c78416" />
            <Addr label="MUSD"                  short="0x1189…c503" href="https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" />
            <Addr label="Skip Oracle (BTC/USD)" short="0x7b7c…0015" href="https://explorer.test.mezo.org/address/0x7b7c000000000000000000000000000000000015" />
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-dim">
        <div className="font-display font-bold text-accent">piton</div>
        <span>Mezo Matsnet · Chain ID 31611 · Unaudited — testnet only</span>
        <div className="flex gap-6">
          <a href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer" className="hover:text-accent transition-colors">Faucet ↗</a>
          <a href="https://mezo.org/docs/developers/" target="_blank" rel="noreferrer" className="hover:text-accent transition-colors">Docs ↗</a>
        </div>
      </footer>
    </div>
  );
}
