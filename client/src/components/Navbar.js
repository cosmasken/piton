import React from 'react';

export default function Navbar({ account, onDisconnect }) {
  return (
    <div style={{ background: '#000', borderRadius: '0' }} className='nav-custom'>
      <a href='/' style={{ cursor: 'pointer' }} className='text-white nav-brand'>piton</a>
      <div className='text-white wallet-add' style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={require('../images/add.png')} className='me-1' width='24' alt='wallet' />{' '}
        {account}
        <button onClick={onDisconnect} style={{ cursor: 'pointer', background: 'transparent', border: '1px solid #444', borderRadius: 8, color: '#aaa', fontSize: 12, fontWeight: 600, padding: '4px 12px', marginLeft: 8 }}
          onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
          onMouseLeave={e => { e.target.style.borderColor = '#444'; e.target.style.color = '#aaa'; }}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
