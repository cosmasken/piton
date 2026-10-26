import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Modal, Button, Spinner } from 'react-bootstrap';
import MUSDABI from '../abi/musd.json';

const MUSD_ADDRESSES = {
  31611: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  31612: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
};

export default function NewOrder({ provider, signer, account, callContract, putContract, onRefresh }) {
  const [position, setPosition]   = useState('long');
  const [optionType, setOptionType] = useState('call');
  const [strike, setStrike]       = useState('');
  const [cost, setCost]           = useState('');
  const [qty, setQty]             = useState('');
  const [settlType, setSettlType] = useState('0');
  const [loading, setLoading]     = useState(false);
  const [modal, setModal]         = useState(false);
  const [marketVal, setMarketVal] = useState(0);

  const isShort = position === 'short';
  const isCall  = optionType === 'call';
  const showSettlType = (isCall && isShort) || (!isCall && !isShort);

  const getMusd = async () => {
    const { chainId } = await provider.getNetwork();
    return new ethers.Contract(MUSD_ADDRESSES[Number(chainId)], MUSDABI.abi, signer);
  };

  const validate = async (e) => {
    e.preventDefault();
    if (!strike || !cost || !qty || +strike <= 0 || +cost <= 0 || +qty <= 0) return;
    const mv = await callContract.getMarketValue();
    setMarketVal(parseFloat(ethers.formatUnits(mv, 18)) * parseFloat(qty));
    setModal(true);
  };

  const submit = async () => {
    setModal(false);
    setLoading(true);
    try {
      const musd = await getMusd();
      const sp   = ethers.parseUnits((+strike * +qty).toString(), 18);
      const c    = ethers.parseUnits(cost, 18);
      const q    = ethers.parseUnits(qty, 18);

      if (isCall && !isShort) {
        await (await musd.approve(await callContract.getAddress(), c)).wait();
        await (await callContract.createNewOptionLong(sp, c, q)).wait();

      } else if (isCall && isShort) {
        if (settlType === '1') {
          const margin = ethers.parseUnits((marketVal * 0.67).toFixed(18), 18);
          await (await musd.approve(await callContract.getAddress(), margin)).wait();
          await (await callContract.createNewOptionShort(1, sp, c, q, margin)).wait();
        } else {
          await (await callContract.createNewOptionShort(0, sp, c, q, 0, { value: q })).wait();
        }

      } else if (!isCall && !isShort) {
        await (await musd.approve(await putContract.getAddress(), c)).wait();
        await (await putContract.createNewOptionLong(settlType, sp, c, q)).wait();

      } else {
        await (await musd.approve(await putContract.getAddress(), sp)).wait();
        await (await putContract.createNewOptionShort(sp, c, q, sp)).wait();
      }

      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='new-order sec-bg text-white text-center'>
      <div className='input-box-header'>New Order</div>
      <div className='container'>
        <div style={{ margin: 'auto' }} className='row text-center mt-3'>
          <div className='col-sm-8 font-weight-bold text-secondary'>
            <div style={{ cursor: 'pointer' }} className='row'>
              <div onClick={() => setPosition('long')}  className={position === 'long'  ? 'green-box col-sm-6' : 'col-sm-6'}>Long</div>
              <div onClick={() => setPosition('short')} className={position === 'short' ? 'red-box col-sm-6'   : 'col-sm-6'}>Short</div>
            </div>
          </div>
          <div className='col-sm-4'>
            <select onChange={e => setOptionType(e.target.value)} className='float-end option-select'>
              <option value='call'>Call</option>
              <option value='put'>Put</option>
            </select>
          </div>
        </div>

        <div className='text-start mt-4'>
          <form onSubmit={validate}>
            <div className='row'>
              <div className='form-group col-sm-12'>
                <label>Strike Price</label>
                <input placeholder='MUSD / 1 BTC' className='form-control form-control-sm' type='number' step='any' value={strike} onChange={e => setStrike(e.target.value)} />
              </div>
              <div className='form-group col-sm-6'>
                <label>Option Cost</label>
                <input placeholder='Premium in MUSD' className='form-control form-control-sm' type='number' step='any' value={cost} onChange={e => setCost(e.target.value)} />
              </div>
              <div className='form-group col-sm-6'>
                <label>Quantity</label>
                <input placeholder='BTC quantity' className='form-control form-control-sm' type='number' step='any' value={qty} onChange={e => setQty(e.target.value)} />
              </div>
              {showSettlType && (
                <div className='form-group col-sm-12'>
                  <label>Settlement Type</label>
                  <select value={settlType} onChange={e => setSettlType(e.target.value)} className='form-control'>
                    <option value='0'>BTC</option>
                    <option value='1'>MUSD</option>
                  </select>
                </div>
              )}
            </div>
            <Button type='submit' className={`mt-1 text-white fw-bold btn btn-block ${isShort ? 'red-bg' : 'green-bg'}`} disabled={loading} variant=''>
              {loading && <Spinner size='sm' animation='grow' className='mb-1 me-2' />}
              {loading ? 'Processing...' : isShort ? 'PLACE SELL ORDER' : 'PLACE BUY ORDER'}
            </Button>
          </form>
        </div>
      </div>

      <Modal className='text-white' show={modal} onHide={() => setModal(false)}>
        <Modal.Header className='head-bg' closeButton>
          <Modal.Title>Confirm Order</Modal.Title>
        </Modal.Header>
        <Modal.Body className='sec-bg'>
          {!isShort && <span>Approve {cost} MUSD as premium to the seller.</span>}
          {isCall && isShort && settlType === '1' && <span>Approve {(0.67 * marketVal).toFixed(2)} MUSD as margin.</span>}
          {isCall && isShort && settlType === '0' && <span>Send {qty} BTC as collateral.</span>}
          {!isCall && isShort && <span>Approve {strike} MUSD as margin.</span>}
        </Modal.Body>
        <Modal.Footer className='head-bg'>
          <Button variant='danger' onClick={() => setModal(false)}>Cancel</Button>
          <Button variant='success' onClick={submit}>Approve & Submit</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
