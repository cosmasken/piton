import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';
import { Spinner, Modal, Button } from 'react-bootstrap';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

function expiry(ts) {
  const exp = dayjs(Number(ts) * 1000);
  const now = dayjs();
  if (exp.isBefore(now)) return 'Expired';
  const h = exp.diff(now, 'hour');
  const m = exp.diff(now, 'minute') % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function OpenOrders({ provider, signer, account, callContract, putContract, onRefresh, tick }) {
  const [callOrders, setCallOrders] = useState([]);
  const [putOrders,  setPutOrders]  = useState([]);
  const [selected,   setSelected]   = useState('call');
  const [mv,         setMv]         = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);
  const [btnLoad,    setBtnLoad]    = useState(false);

  useEffect(() => {
    if (!callContract) return;
    (async () => {
      try {
        let rawMv;
        try {
          rawMv = await callContract.getMarketValue();
        } catch {
          try {
            const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
            const { price } = await res.json();
            rawMv = ethers.parseUnits(parseFloat(price).toFixed(18), 18);
          } catch { return; }
        }
        setMv(parseFloat(ethers.formatUnits(rawMv, 18)));

        const load = async (contract, setter) => {
          try {
            const total = await contract.uniqueId();
            const orders = [];
            for (let i = 1; i < Number(total); i++) {
              try {
                const o = await contract.idToOption(i);
                if (o.isAvailable) orders.push(o);
              } catch {}
            }
            setter(orders);
          } catch {}
        };

        await Promise.all([
          load(callContract, setCallOrders),
          load(putContract,  setPutOrders),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [callContract, putContract, tick]);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const fmt = v => parseFloat(ethers.formatUnits(v, 18));

  const buyToOpen = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      const musd = await getMusd();
      await (await musd.approve(await callContract.getAddress(), o.cost)).wait();
      await (await callContract.buyToOpen(o.id)).wait();
      onRefresh();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const sellToOpen = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      const settlType = modal.settlType;
      const musd = await getMusd();
      if (settlType === 1) {
        const margin = ethers.parseUnits((mv * fmt(o.quantity) * 0.67).toFixed(18), 18);
        await (await musd.approve(await callContract.getAddress(), margin)).wait();
        await (await callContract.sellToOpen(o.id, 1, margin)).wait();
      } else {
        await (await callContract.sellToOpen(o.id, 0, 0, { value: o.quantity })).wait();
      }
      onRefresh();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const buyPut = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      const musd = await getMusd();
      await (await musd.approve(await putContract.getAddress(), o.cost)).wait();
      await (await putContract.buyToOpen(o.id, modal.settlType)).wait();
      onRefresh();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const sellPut = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      const musd = await getMusd();
      await (await musd.approve(await putContract.getAddress(), o.strikePrice)).wait();
      await (await putContract.sellToOpen(o.id, o.strikePrice)).wait();
      onRefresh();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const rows = (orders, isCall) => orders.map((o, i) => {
    const qty = fmt(o.quantity); const sp = fmt(o.strikePrice); const c = fmt(o.cost);
    const exp = expiry(o.expiry);
    const openPos = o.openPosition === 0n || o.openPosition === 0 ? 'Long' : 'Short';
    return (
      <tr key={i} className='fade-in order-row'>
        <td style={{ fontSize: '12px' }}>{exp}</td>
        <td>{openPos}</td>
        <td>{sp.toFixed(2)}</td>
        <td>{c.toFixed(4)}</td>
        <td>{qty.toFixed(4)}</td>
        <td>
          {exp !== 'Expired' && o.partyL !== account && o.partyS !== account && (
            <span className='text-primary' style={{ cursor: 'pointer' }}
              onClick={() => setModal({ order: o, isCall, action: openPos === 'Long' ? (isCall ? 'buyCall' : 'buyPut') : (isCall ? 'sellCall' : 'sellPut'), settlType: 0 })}>
              Fill
            </span>
          )}
        </td>
      </tr>
    );
  });

  const actionMap = { buyCall: buyToOpen, sellCall: sellToOpen, buyPut, sellPut };

  return (
    <div className='open-orders sec-bg'>
      <div className='mb-2 input-box-header'>
        <span className='ms-3'>Open Orders</span>
        <select onChange={e => setSelected(e.target.value)} style={{ background: '#242424' }} className='me-3 float-end option-select-top'>
          <option value='call'>Call</option>
          <option value='put'>Put</option>
        </select>
      </div>
      <div className='o-orders-bar text-center'>
        {loading ? <Spinner size='sm' animation='border' variant='light' /> : (
          <table>
            <thead><tr className='text-secondary open-header'><th>Expiry</th><th>Open</th><th>Strike</th><th>Cost</th><th>Qty</th><th></th></tr></thead>
            <tbody>{selected === 'call' ? rows(callOrders, true) : rows(putOrders, false)}</tbody>
          </table>
        )}
        {!loading && selected === 'call' && callOrders.length === 0 && <p className='mt-5 text-secondary'>No open call orders.</p>}
        {!loading && selected === 'put'  && putOrders.length  === 0 && <p className='mt-5 text-secondary'>No open put orders.</p>}
      </div>

      <Modal backdrop='static' className='text-white' show={!!modal} onHide={() => setModal(null)}>
        <Modal.Header className='head-bg' closeButton><Modal.Title>Fill Order</Modal.Title></Modal.Header>
        <Modal.Body className='sec-bg'>
          {modal && <span>You are taking the <strong>{modal.action.startsWith('buy') ? 'Long' : 'Short'}</strong> position on this {modal.isCall ? 'call' : 'put'} option.</span>}
        </Modal.Body>
        <Modal.Footer className='head-bg'>
          <Button variant='secondary' disabled={btnLoad} onClick={() => setModal(null)}>Cancel</Button>
          <Button variant='success' disabled={btnLoad} onClick={() => modal && actionMap[modal.action]()}>
            {btnLoad && <Spinner size='sm' animation='grow' className='mb-1 me-2' />}Confirm
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
