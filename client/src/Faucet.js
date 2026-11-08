import React from 'react';

export default function Faucet() {
  return (
    <div className='mt-5 text-center container'>
      <h2 className='text-white'>Get Test Tokens</h2>
      <p className='text-secondary'>
        Get test BTC and MUSD from the official Mezo testnet faucet.
      </p>
      <a
        href='https://faucet.test.mezo.org'
        target='_blank'
        rel='noopener noreferrer'
        className='btn btn-lg btn-success'
      >
        Mezo Testnet Faucet →
      </a>
    </div>
  );
}
