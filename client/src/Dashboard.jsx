import React, { useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useStore } from './store';
import { mezoMatsnet } from './wagmi';

import Navbar      from './components/Navbar';
import MarketValue from './components/MarketValue';
import NewOrder    from './components/NewOrder';
import Graph       from './components/graph';
import OpenOrders  from './components/OpenOrders';
import Wallet      from './components/Wallet';
import YourOrders  from './components/YourOrders';

export default function Dashboard() {
  const { address, chainId, isConnected } = useAccount();
  const { connect }      = useConnect();
  const { disconnect }   = useDisconnect();
  const { switchChain }  = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const { init, reset, fetchPrice, fetchBalances, fetchOrders, tick } = useStore();

  // init store when wallet connects
  useEffect(() => {
    if (walletClient && chainId === mezoMatsnet.id) init(walletClient, chainId);
    else reset();
  }, [walletClient, chainId]); // eslint-disable-line

  // poll price every 30s
  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 30_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  // refetch balances + orders on tick
  useEffect(() => {
    if (isConnected && chainId === mezoMatsnet.id) {
      fetchBalances();
      fetchOrders();
    }
  }, [tick]); // eslint-disable-line

  if (!isConnected) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="font-display text-2xl text-accent">piton</p>
      <p className="text-dim text-sm font-body">Connect your wallet to start trading</p>
      <button className="btn-primary" onClick={() => connect({ connector: injected() })}>
        Connect Wallet
      </button>
    </div>
  );

  if (chainId !== mezoMatsnet.id) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="text-dim text-sm font-body">Switch to <span className="text-accent">Mezo Matsnet</span> (Chain ID 31611)</p>
      <button className="btn-primary" onClick={() => switchChain({ chainId: mezoMatsnet.id })}>
        Switch Network
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <Navbar onDisconnect={disconnect} />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[220px_1fr_240px] grid-rows-[auto] gap-2 p-2 overflow-hidden min-h-0">
        {/* left col */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <MarketValue />
          <NewOrder />
        </div>
        {/* centre col */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <Graph />
          <OpenOrders />
        </div>
        {/* right col */}
        <div className="flex flex-col gap-2 overflow-hidden">
          <Wallet />
          <YourOrders />
        </div>
      </div>
    </div>
  );
}
