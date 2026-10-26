import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Spinner } from 'react-bootstrap';

import getProvider from './getWeb3';
import CallOptionABI from './contracts/CallOption.json';
import PutOptionABI from './contracts/PutOption.json';

import Navbar from './components/Navbar';
import MarketValue from './components/MarketValue';
import NewOrder from './components/NewOrder';
import Graph from './components/graph';
import OpenOrder from './components/OpenOrders';
import Wallet from './components/Wallet';
import YourOrder from './components/YourOrders';

// Deployed on Mezo matsnet (chainId 31611)
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
        const signer = await provider.getSigner();
        const account = await signer.getAddress();
        const { chainId } = await provider.getNetwork();

        setState({ provider, signer, account, chainId: Number(chainId), loading: false });
      } catch {
        setState(s => ({ ...s, loading: false }));
      }
    })();
  }, []);

  if (state.loading) {
    return (
      <div className='loader container text-white text-center'>
        <Spinner size='lg' animation='border' />
        <span> Connecting wallet <img width='36' src={require('./images/meta.png')} alt='metamask' /></span>
      </div>
    );
  }

  if (!state.provider || state.chainId !== MEZO_CHAIN_ID) {
    window.location.href = '/';
    return null;
  }

  const addrs = CONTRACT_ADDRESSES[state.chainId];
  const callContract = new ethers.Contract(addrs.call, CallOptionABI.abi, state.signer);
  const putContract  = new ethers.Contract(addrs.put,  PutOptionABI.abi,  state.signer);

  const shared = { provider: state.provider, signer: state.signer, account: state.account, callContract, putContract, onRefresh: refresh, tick };

  return (
    <div className='custom-row-main'>
      <Navbar account={state.account} onDisconnect={() => setState({ provider: null, signer: null, account: null, chainId: null, loading: false })} />
      <MarketValue {...shared} />
      <NewOrder    {...shared} />
      <Graph       {...shared} />
      <OpenOrder   {...shared} />
      <Wallet      {...shared} />
      <YourOrder   {...shared} />
    </div>
  );
}
