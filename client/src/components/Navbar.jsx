import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function Navbar() {
  return (
    <nav className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg shrink-0">
      <a href="/" className="font-display font-bold text-lg text-accent tracking-tight">piton</a>
      <ConnectButton
        showBalance={false}
        chainStatus="none"
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
      />
    </nav>
  );
}
