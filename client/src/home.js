import React from 'react';
import { useNavigate } from 'react-router-dom';

function Addr({ label, short, href }) {
  return (
    <a className='addr-row' href={href} target='_blank' rel='noreferrer'>
      <span className='addr-label'>{label}</span>
      <span className='addr-val'>{short} ↗</span>
    </a>
  );
}

export default function Home() {
  const navigate = useNavigate();
  return (
    <>
      <nav>
        <div className='nav-logo'>
          <div className='logo-mark'>P</div>
          piton
        </div>
        <div className='nav-links'>
          <a href='#how'>How it works</a>
          <a href='#contracts'>Contracts</a>
          <a href='https://faucet.test.mezo.org' target='_blank' rel='noreferrer'>Faucet</a>
          <a href='https://github.com' target='_blank' rel='noreferrer'>GitHub</a>
        </div>
        <button className='btn' onClick={() => navigate('/dashboard')}>Launch App →</button>
      </nav>

      {/* Hero */}
      <section className='hero'>
        <div className='hero-glow' />
        <h1>Bitcoin Options,<br /><span>Settled On-Chain.</span></h1>
        <p>
          Trade American-style BTC call &amp; put options priced in{' '}
          <strong style={{ color: 'var(--text)' }}>MUSD</strong> — Mezo's Bitcoin-backed stablecoin.
          No intermediaries. No custody. Fully collateralised.
        </p>
        <div className='hero-cta'>
          <button className='btn lg' onClick={() => navigate('/dashboard')}>Start Trading →</button>
          <a className='btn lg ghost' href='#how'>How it works</a>
        </div>
        <div className='stats-row'>
          <div className='stat'><div className='stat-value'>48h</div><div className='stat-label'>Max Expiry</div></div>
          <div className='stat-divider' />
          <div className='stat'><div className='stat-value'>2/3</div><div className='stat-label'>Min Margin</div></div>
          <div className='stat-divider' />
          <div className='stat'><div className='stat-value'>0%</div><div className='stat-label'>Platform Fee</div></div>
          <div className='stat-divider' />
          <div className='stat'><div className='stat-value'>BTC + MUSD</div><div className='stat-label'>Settlement</div></div>
        </div>
      </section>

      {/* How it works */}
      <div className='alt-section' id='how'>
        <div className='section'>
          <div className='section-label'>Protocol</div>
          <h2>How Piton works</h2>
          <div className='steps'>
            {[
              ['1', 'Place an Order',      'Set your strike price, premium, and quantity. Long positions pay MUSD premium upfront. Short positions post BTC or 2/3 MUSD as collateral.'],
              ['2', 'Fill from the Book',  'Any wallet can take the opposite side of an open order directly on-chain. No matching engine — pure OTC peer-to-peer.'],
              ['3', 'Settle Anytime',      'American-style — exercise before expiry whenever it\'s profitable. Settle in BTC or MUSD. Price sourced from the Skip oracle, updated every block.'],
              ['4', 'Reclaim Collateral',  'Expired unexercised options release collateral back to the short. No liquidations, no funding rates — just clean expiry.'],
            ].map(([n, title, body]) => (
              <div key={n} className='step-card'>
                <div className='step-bg-num'>{n}</div>
                <div className='step-num'>{n}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Products */}
      <div className='section' style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div className='section-label'>Products</div>
        <h2>Two instruments, full coverage</h2>
        <div className='steps'>
          <div className='step-card'>
            <div className='step-num' style={{ background: 'rgba(34,197,94,.12)', borderColor: 'rgba(34,197,94,.3)', color: 'var(--green)', fontSize: 18 }}>📈</div>
            <h3>Call Options</h3>
            <p>Right to buy BTC at the strike price. Long calls profit when BTC rises above strike. Short calls collect premium, post BTC or MUSD margin.</p>
          </div>
          <div className='step-card'>
            <div className='step-num' style={{ background: 'rgba(239,68,68,.12)', borderColor: 'rgba(239,68,68,.3)', color: 'var(--red)', fontSize: 18 }}>📉</div>
            <h3>Put Options</h3>
            <p>Right to sell BTC at the strike price. Long puts profit when BTC falls below strike. Short puts collect premium, post MUSD as margin.</p>
          </div>
          <div className='step-card'>
            <div className='step-num' style={{ background: 'rgba(123,94,167,.15)', borderColor: 'rgba(123,94,167,.3)', color: 'var(--purple)', fontSize: 18 }}>🔒</div>
            <h3>Fully Collateralised</h3>
            <p>Every short position is backed on-chain. No counterparty risk. Skip oracle updates every block on Mezo.</p>
          </div>
        </div>
      </div>

      {/* Contracts */}
      <div className='alt-section' id='contracts'>
        <div className='section'>
          <div className='section-label'>Deployed Contracts</div>
          <h2>Mezo Matsnet (Chain ID 31611)</h2>
          <div className='addr-grid'>
            <Addr label='CallOption'           short='0x2782…7516' href='https://explorer.test.mezo.org/address/0x278269C888E18D73c315Df8BDE54711905637516' />
            <Addr label='PutOption'            short='0x5857…17Ca' href='https://explorer.test.mezo.org/address/0x58579360e86BD2f489578b410C5284757EE517Ca' />
            <Addr label='MUSD'                 short='0x1189…c503' href='https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503' />
            <Addr label='Skip Oracle (BTC/USD)' short='0x7b7c…0015' href='https://explorer.test.mezo.org/address/0x7b7c000000000000000000000000000000000015' />
          </div>
          <p style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
            Explorer:{' '}
            <a href='https://explorer.test.mezo.org' target='_blank' rel='noreferrer' style={{ color: 'var(--accent)' }}>
              explorer.test.mezo.org ↗
            </a>
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer>
        <div className='nav-logo' style={{ fontSize: 14 }}>
          <div className='logo-mark' style={{ width: 26, height: 26, fontSize: 11 }}>P</div>
          piton
        </div>
        <span>Mezo Matsnet · Chain ID 31611 · Bitcoin Options Protocol</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <a href='https://github.com' target='_blank' rel='noreferrer'>GitHub ↗</a>
          <a href='https://faucet.test.mezo.org' target='_blank' rel='noreferrer'>Faucet ↗</a>
          <a href='https://mezo.org/docs/developers/' target='_blank' rel='noreferrer'>Docs ↗</a>
        </div>
      </footer>
    </>
  );
}
