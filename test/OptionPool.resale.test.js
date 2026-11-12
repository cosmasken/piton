// Resale: the holder of a live option lists it on the book and another trader buys it (becomes the holder).
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { POOL_ERRORS } = require('./helpers/poolErrors');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, lp, buyer, other, third] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await poolFactory()).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900);
  await pool.setBreaker(600, 50000, 0);
  await pool.setTVLCap(E18('1000000000')); await pool.setMaxOptionCollateral(E18('10000000'));
  for (const w of [owner, lp, buyer, other, third]) {
    await musd.mint(w.address, E18('10000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  await pool.connect(lp).deposit(E18('1000000'));
  return { pool, musd, ymusd, oracle, owner, lp, buyer, other, third };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
const K = E18('100000'), Q = E18('0.1');

/** buyer buys an ATM put from the pool */
async function poolPut(c, secs = 86400) {
  const exp = (await now()) + secs;
  const prem = await c.pool.quotePremium(false, K, Q, exp);
  await c.pool.connect(c.buyer).createLongOrder(1, K, Q, exp, prem);
  return (await c.pool.nextId()) - 1n;
}
/** `other` sells an ATM put on the book and buyer takes it (option between two traders) */
async function traderPut(c, secs = 86400) {
  const exp = (await now()) + secs;
  await c.pool.connect(c.other).createShortOrder(1, K, Q, exp, E18('300'));
  const id = (await c.pool.nextId()) - 1n;
  await c.pool.connect(c.buyer).fillLong(id);
  return id;
}

describe('Resale on the book', () => {
  it('a pool-sold option changes hands at the listed price; the pool is untouched', async () => {
    const c = await deploy();
    const id = await poolPut(c);
    const price = E18('250');
    await expect(c.pool.connect(c.buyer).listLong(id, price)).to.emit(c.pool, 'Listed').withArgs(id, c.buyer.address, price);
    expect(await c.pool.listPrice(id)).to.equal(price);

    const before = { assets: await c.pool.totalAssets(), locked: await c.pool.lockedCollateral(), open: await c.pool.openPoolOptionCount(),
      seller: await c.musd.balanceOf(c.buyer.address), fee: await c.musd.balanceOf(await c.pool.feeRecipient()) };
    await expect(c.pool.connect(c.third).buyListed(id, price)).to.emit(c.pool, 'Resold').withArgs(id, c.buyer.address, c.third.address, price);

    const o = await c.pool.getOption(id);
    expect(o.long).to.equal(c.third.address);
    expect(await c.pool.listPrice(id)).to.equal(0n);
    const fee = price * (await c.pool.protocolFeeBps()) / 10000n;
    expect((await c.musd.balanceOf(c.buyer.address)) - before.seller).to.equal(price - fee);
    expect((await c.musd.balanceOf(await c.pool.feeRecipient())) - before.fee).to.equal(fee);
    expect(await c.pool.totalAssets()).to.equal(before.assets);
    expect(await c.pool.lockedCollateral()).to.equal(before.locked);
    expect(await c.pool.openPoolOptionCount()).to.equal(before.open);

    // only the new holder can sell it back
    await expect(c.pool.connect(c.buyer).sellBack(id, 0)).to.be.revertedWithCustomError(POOL_ERRORS, 'OnlyLongCanSellBack');
    await expect(c.pool.connect(c.third).sellBack(id, 0)).to.emit(c.pool, 'SoldBack');
  });

  it('an option bought from another trader can be resold, and the new holder exercises it', async () => {
    const c = await deploy();
    const id = await traderPut(c);
    await c.pool.connect(c.buyer).listLong(id, E18('200'));
    await c.pool.connect(c.third).buyListed(id, E18('200'));
    await time.increase(60); await c.oracle.setPrice(90_000);       // put is 10,000/BTC in the money -> 1,000 MUSD
    const shortBefore = await c.musd.balanceOf(c.other.address), holderBefore = await c.musd.balanceOf(c.third.address);
    await expect(c.pool.connect(c.buyer).settle(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'OnlyLongCanSettle');
    await c.pool.connect(c.third).settle(id);
    expect((await c.musd.balanceOf(c.third.address)) - holderBefore).to.equal(E18('1000'));
    expect((await c.musd.balanceOf(c.other.address)) - shortBefore).to.equal(E18('9000'));   // the rest of the seller's collateral
  });

  it('the buyer is protected if the seller raises the price; delisting and wrong callers are refused', async () => {
    const c = await deploy();
    const id = await poolPut(c);
    await expect(c.pool.connect(c.other).listLong(id, E18('1'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotYourOpenOption');
    await expect(c.pool.connect(c.third).buyListed(id, E18('1000'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotListed');
    await c.pool.connect(c.buyer).listLong(id, E18('100'));
    await c.pool.connect(c.buyer).listLong(id, E18('500'));          // raised while a buyer's 100 MUSD offer is in flight
    await expect(c.pool.connect(c.third).buyListed(id, E18('100'))).to.be.revertedWithCustomError(POOL_ERRORS, 'PriceAboveMax');
    await expect(c.pool.connect(c.buyer).buyListed(id, E18('500'))).to.be.revertedWithCustomError(POOL_ERRORS, 'CannotSelfFill');
    await c.pool.connect(c.buyer).listLong(id, 0);                   // delist
    await expect(c.pool.connect(c.third).buyListed(id, E18('500'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotListed');
  });

  it('a listing ends when the option is sold back or expires; paused pools refuse resale', async () => {
    const c = await deploy();
    const a = await poolPut(c), b = await poolPut(c, 3600);
    await c.pool.connect(c.buyer).listLong(a, E18('100'));
    await c.pool.connect(c.buyer).sellBack(a, 0);
    await expect(c.pool.connect(c.third).buyListed(a, E18('100'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotListed');
    await c.pool.connect(c.buyer).listLong(b, E18('100'));
    await c.pool.pausePool();
    await expect(c.pool.connect(c.third).buyListed(b, E18('100'))).to.be.revertedWithCustomError(POOL_ERRORS, 'Paused');
    await c.pool.unpausePool();
    await time.increase(3601);
    await expect(c.pool.connect(c.third).buyListed(b, E18('100'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotListed');
    await expect(c.pool.connect(c.buyer).listLong(b, E18('1'))).to.be.revertedWithCustomError(POOL_ERRORS, 'NotYourOpenOption');
  });

  it('auto-exercise is switched off for the new holder', async () => {
    const c = await deploy();
    const id = await poolPut(c);
    await c.pool.connect(c.buyer).setAutoExercise(id, true);
    await c.pool.connect(c.buyer).listLong(id, E18('50'));
    await expect(c.pool.connect(c.third).buyListed(id, E18('50'))).to.emit(c.pool, 'AutoExerciseSet').withArgs(id, false);
    expect(await c.pool.autoExercise(id)).to.equal(false);
  });
});
