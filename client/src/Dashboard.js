import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Spinner } from 'react-bootstrap';

import getProvider from './getWeb3';
import CallOptionABI from './contracts/CallOption.json';
import PutOptionABI  from './contracts/PutOption.json';

import Navbar     from './components/Navbar';
import MarketValue from './components/MarketValue';
import NewOrder   from './components/NewOrder';
import Graph      from './components/graph';
import OpenOrder  from './components/OpenOrders';
import Wallet     from './components/Wallet';
import YourOrder  from './components/YourOrders';

const CONTRACT_ADDRESSES = {
  31611: {
    call: '0x278269C888E18D73c315Df8BDE54711905637516',
    put:  '0x58579360e86BD2f489578b410C5284757EE517Ca',
  },
};
const MEZO_CHAIN_ID = 31611;

export default function Dashboard() {
  const [state, setState] = useState({ provider: null, signer: null, account: null, chainId: null, loading: true });
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  useEffect(() => {
    (async () => {
      try {
        const provider = await getProvider();
        const signer   = await provider.getSigner();
        const account  = await signer.getAddress();
        const { chainId } = await provider.getNetwork();
        setState({ provider, signer, account, chainId: Number(chainId), loading: false });
      } catch {
        setState(s => ({ ...s, loading: false }));
      }
    })();
  }, []);

  if (state.loading) return (
    <div className="flex items-center justify-center h-screen gap-3 text-text">
      <Spinner size="sm" animation="border" />
      <span className="font-body text-sm text-dim">Connecting wallet…</span>
    </div>
  );

  if (!state.provider || state.chainId !== MEZO_CHAIN_ID) {
    const switchNetwork = async () => {
      try {
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7B8B' }] });
        window.location.reload();
      } catch (err) {
        if (err.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: '0x7B8B', chainName: 'Mezo Matsnet', rpcUrls: ['https://rpc.test.mezo.org'], nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 }, blockExplorerUrls: ['https://explorer.test.mezo.org'] }],
          });
          window.location.reload();
        }
      }
    };
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 text-text">
        <p className="font-body text-sm text-dim">Connect to <span className="text-accent">Mezo Matsnet</span> (Chain ID 31611)</p>
        <button className="btn-primary" onClick={switchNetwork}>Switch Network</button>
      </div>
    );
  }

  const addrs = CONTRACT_ADDRESSES[state.chainId];
  const callContract = new ethers.Contract(addrs.call, CallOptionABI.abi, state.signer);
  const putContract  = new ethers.Contract(addrs.put,  PutOptionABI.abi,  state.signer);
  const shared = { provider: state.provider, signer: state.signer, account: state.account, callContract, putContract, onRefresh: refresh, tick };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar account={state.account} onDisconnect={() => setState({ provider: null, signer: null, account: null, chainId: null, loading: false })} />
      {/* main grid */}
      <div className="flex-1 grid grid-cols-[240px_1fr_260px] grid-rows-[auto_1fr] gap-2 p-2 overflow-hidden min-h-0">
        <MarketValue {...shared} />
        <Graph       {...shared} className="row-span-1" />
        <Wallet      {...shared} />
        <NewOrder    {...shared} />
        <OpenOrder   {...shared} />
        <YourOrder   {...shared} />
      </div>
    </div>
  );
}
