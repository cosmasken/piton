import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

export default function Wallet({ provider, account }) {
  const [btc, setBtc]   = useState('—');
  const [musd, setMusd] = useState('—');

  useEffect(() => {
    if (!provider || !account) return;

    const update = async () => {
      try {
        const { chainId } = await provider.getNetwork();
        const musdAddr = MUSD_ADDRESSES[Number(chainId)];
        const musdContract = new ethers.Contract(musdAddr, MUSDABI.abi, provider);

        const [btcBal, musdBal] = await Promise.all([
          provider.getBalance(account),
          musdContract.balanceOf(account),
        ]);

        setBtc(parseFloat(ethers.formatEther(btcBal)).toFixed(4));
        setMusd(parseFloat(ethers.formatUnits(musdBal, 18)).toFixed(2));
      } catch {}
    };

    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [provider, account]);

  return (
    <div className='sec-bg wallet text-white'>
      <div className='input-box-header text-center'>
        <img className='ms-2 mb-1' src={require('../images/meta.png')} width='24' alt='wallet' />{' '}Wallet
      </div>
      <table className='w-100'>
        <tbody>
          <tr>
            <td className='text-center'><img src={require('../images/btc.png')} width='36' alt='btc' /></td>
            <td>{btc} BTC</td>
            <td className='text-center'><img src={require('../images/musd.png')} width='36' alt='musd' /></td>
            <td>{musd} MUSD</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
