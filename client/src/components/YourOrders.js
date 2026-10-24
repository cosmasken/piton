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

export default function YourOrders({ provider, signer, account, callContract, putContract }) {
  const [callOrders, setCallOrders] = useState([]);
  const [putOrders,  setPutOrders]  = useState([]);
  const [selected,   setSelected]   = useState('call');
  const [mv,         setMv]         = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null); // { type, order, action }
  const [btnLoad,    setBtnLoad]    = useState(false);

  useEffect(() => {
    if (!account) return;
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

        const loadOrders = async (contract, setter) => {
          try {
            const count = await contract.getOptionsCount(account);
            const orders = [];
            for (let i = Number(count) - 1; i >= 0; i--) {
              try {
                const id  = await contract.addressToOptions(account, i);
                const opt = await contract.idToOption(id);
                if (!opt.settled) orders.push(opt);
              } catch {}
            }
            setter(orders);
          } catch {}
        };

        await Promise.all([
          loadOrders(callContract, setCallOrders),
          loadOrders(putContract,  setPutOrders),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [account, callContract, putContract]);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const closeCall = async () => {
    setBtnLoad(true);
    try { await (await callContract.closeOption(modal.order.id)).wait(); window.location.reload(); }
    catch (e) { console.error(e); setBtnLoad(false); }
  };

  const refundCall = async () => {
    setBtnLoad(true);
    try { await (await callContract.refundExpired(modal.order.id)).wait(); window.location.reload(); }
    catch (e) { console.error(e); setBtnLoad(false); }
  };

  const settleCall = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      if (Number(o.settlementType) === 0) {
        const musd = await getMusd();
        await (await musd.approve(await callContract.getAddress(), o.strikePrice)).wait();
      }
      await (await callContract.settleOption(o.id)).wait();
      window.location.reload();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const closePut = async () => {
    setBtnLoad(true);
    try { await (await putContract.closeOption(modal.order.id)).wait(); window.location.reload(); }
    catch (e) { console.error(e); setBtnLoad(false); }
  };

  const refundPut = async () => {
    setBtnLoad(true);
    try { await (await putContract.refundExpired(modal.order.id)).wait(); window.location.reload(); }
    catch (e) { console.error(e); setBtnLoad(false); }
  };

  const settlePut = async () => {
    setBtnLoad(true);
    try {
      const o = modal.order;
      const value = Number(o.settlementType) === 0 ? o.quantity : 0n;
      await (await putContract.settleOption(o.id, { value })).wait();
      window.location.reload();
    } catch (e) { console.error(e); setBtnLoad(false); }
  };

  const fmt = v => parseFloat(ethers.formatUnits(v, 18));

  const rows = (orders, isCall) => orders.map((o, i) => {
    const qty  = fmt(o.quantity);
    const sp   = fmt(o.strikePrice);
    const c    = fmt(o.cost);
    const mval = mv * qty;
    const exp  = expiry(o.expiry);
    const pos  = o.partyS === account ? 'Short' : 'Long';
    const PL   = exp !== 'Expired' && !o.isAvailable
      ? (isCall
          ? (pos === 'Long' ? mval - sp - c : Math.min(c, c - (mval - sp)))
          : (pos === 'Long' ? sp - mval - c : Math.min(c, c - (sp - mval))))
      : 0;

    return (
      <tr key={i} className='fade-in order-row'>
        <td style={{ fontSize: '12px' }} className={exp === 'Expired' ? 'light-white' : ''}>{exp}</td>
        <td>{pos}</td>
        <td className={PL > 0 ? 'text-success' : PL < 0 ? 'text-danger' : 'text-dark'}>
          {PL !== 0 ? PL.toFixed(1) : 'N/A'}
        </td>
        <td>
          {o.isAvailable && (
            <span className='text-warning' style={{ cursor: 'pointer' }}
              onClick={() => setModal({ order: o, action: isCall ? 'closeCall' : 'closePut' })}>Refund</span>
          )}
          {!o.isAvailable && exp === 'Expired' && pos === 'Short' && (
            <span className='text-warning' style={{ cursor: 'pointer' }}
              onClick={() => setModal({ order: o, action: isCall ? 'refundCall' : 'refundPut' })}>Refund</span>
          )}
          {!o.isAvailable && exp !== 'Expired' && pos === 'Long' && (
            <span className='text-primary' style={{ cursor: 'pointer' }}
              onClick={() => setModal({ order: o, action: isCall ? 'settleCall' : 'settlePut' })}>Settle</span>
          )}
          {!o.isAvailable && exp !== 'Expired' && pos === 'Short' && <span className='text-dark'>N/A</span>}
          {!o.isAvailable && exp === 'Expired' && pos === 'Long' && <span className='text-dark'>-</span>}
        </td>
      </tr>
    );
  });

  const actionMap = { closeCall, refundCall, settleCall, closePut, refundPut, settlePut };

  return (
    <div className='your-orders sec-bg'>
      <div className='mb-2 input-box-header'>
        <span className='ms-3'>Your Orders</span>
        <select onChange={e => setSelected(e.target.value)} style={{ background: '#242424' }} className='me-3 float-end option-select-top'>
          <option value='call'>Call</option>
          <option value='put'>Put</option>
        </select>
      </div>
      <div className='y-orders-bar text-center'>
        {loading ? <Spinner size='sm' animation='border' variant='light' /> : (
          <table>
            <thead><tr className='text-secondary open-header'><th>Expiry</th><th>Position</th><th>P/L</th><th>Action</th></tr></thead>
            <tbody>{selected === 'call' ? rows(callOrders, true) : rows(putOrders, false)}</tbody>
          </table>
        )}
        {!loading && selected === 'call' && callOrders.length === 0 && <p className='mt-5 text-secondary'>No call orders.</p>}
        {!loading && selected === 'put'  && putOrders.length  === 0 && <p className='mt-5 text-secondary'>No put orders.</p>}
      </div>

      <Modal backdrop='static' className='text-white' show={!!modal} onHide={() => setModal(null)}>
        <Modal.Header className='head-bg' closeButton>
          <Modal.Title>Confirm Action</Modal.Title>
        </Modal.Header>
        <Modal.Body className='sec-bg'>
          {modal && (() => {
            const o = modal.order;
            const sp = fmt(o.strikePrice); const qty = fmt(o.quantity);
            const mval = mv * qty;
            if (modal.action === 'settleCall') return Number(o.settlementType) === 0
              ? <span>Receive {qty} BTC in exchange for {sp} MUSD.</span>
              : <span>Receive {(mval - sp).toFixed(2)} MUSD profit.</span>;
            if (modal.action === 'settlePut') return Number(o.settlementType) === 0
              ? <span>Send {qty} BTC, receive {sp} MUSD.</span>
              : <span>Receive {(sp - mval).toFixed(2)} MUSD profit.</span>;
            if (modal.action === 'closeCall' || modal.action === 'closePut')
              return <span>Refund your escrowed collateral.</span>;
            return <span>Reclaim expired escrow.</span>;
          })()}
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
