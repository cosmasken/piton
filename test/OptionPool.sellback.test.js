// Selling an option back to the pool before expiry (closing a long position).
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const E18 = ethers.parseEther, f = v => Number(ethers.formatEther(v));

async function deploy() {
  const [owner, lp, buyer, other] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await ethers.getContractFactory('OptionPool')).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900);
  await pool.setBreaker(600, 50000, 0);
  await pool.setTVLCap(E18('1000000000')); await pool.setMaxOptionCollateral(E18('10000000'));
  for (const w of [owner, lp, buyer, other]) {
    await musd.mint(w.address, E18('10000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  await pool.connect(lp).deposit(E18('1000000'));
  return { pool, musd, ymusd, oracle, owner, lp, buyer, other };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
const K = E18('100000'), Q = E18('0.1');
async function buyAtm(c, isCall = false, secs = 86400) {
  const exp = (await now()) + secs;
  const prem = await c.pool.quotePremium(isCall, K, Q, exp);
  await c.pool.connect(c.buyer).createLongOrder(isCall ? 0 : 1, K, Q, exp, prem);
  const id = (await c.pool.nextId()) - 1n;
  expect((await c.pool.getOption(id)).filledByPool).to.equal(true);
  return { id, prem, exp };
}

describe('Sell back to the pool', () => {
  it('pays a bid below what the buyer paid, and books the position as closed', async () => {
    const c = await deploy();
    const { id, prem } = await buyAtm(c);
    const bid = await c.pool.quoteBuyback(id);
    expect(bid).to.be.gt(0n).and.to.be.lt(prem * 90n / 100n);        // spread on both sides: round trip loses money
    const before = await c.musd.balanceOf(c.buyer.address), assets = await c.pool.totalAssets();
    const tx = await c.pool.connect(c.buyer).sellBack(id, bid * 99n / 100n);   // price moves a little with time
    const paid = (await c.musd.balanceOf(c.buyer.address)) - before;
    await expect(tx).to.emit(c.pool, 'SoldBack').withArgs(id, c.buyer.address, paid);
    expect(paid).to.be.closeTo(bid, bid / 100n);
    expect(assets - (await c.pool.totalAssets())).to.be.gte(paid);       // payout (plus any performance fee) left the pool
    expect((await c.pool.getOption(id)).status).to.equal(4n);          // CLOSED
    expect(await c.pool.lockedCollateral()).to.equal(0n);
    expect(await c.pool.openPoolOptionCount()).to.equal(0n);
    expect(await c.pool.unrecognizedPremium()).to.equal(0n);
  });

  it('never pays more than the mid-volatility value, and the payout is capped by collateral', async () => {
    const c = await deploy();
    const { id } = await buyAtm(c, true);
    const o = await c.pool.getOption(id);
    const mid = (await c.pool.bsPrice(true, E18('100000'), K, o.expiry - BigInt(await now()))) * Q / E18('1');
    // ATM value is almost linear in volatility, so a 10% volatility spread means a bid about 10% under mid
    expect(await c.pool.quoteBuyback(id)).to.be.lt(mid * 92n / 100n).and.to.be.gt(mid * 85n / 100n);
    await time.increase(60); await c.oracle.setPrice(130000);          // deep in the money
    const bid = await c.pool.quoteBuyback(id);
    expect(bid).to.be.gt(0n).and.to.be.lte((await c.pool.getOption(id)).collateral);
  });

  it('LP share value does not fall when a fresh position is bought back', async () => {
    const c = await deploy();
    const { id } = await buyAtm(c);
    const nav = async () => (await c.pool.netAssetValue()) * E18('1') / (await c.ymusd.totalSupply());
    const before = await nav();
    await c.pool.connect(c.buyer).sellBack(id, 0n);
    expect(await nav()).to.be.gte(before);
  });

  it('respects the minimum payout (slippage protection)', async () => {
    const c = await deploy();
    const { id } = await buyAtm(c);
    const bid = await c.pool.quoteBuyback(id);
    await expect(c.pool.connect(c.buyer).sellBack(id, bid * 2n)).to.be.revertedWith('no bid');
    await c.pool.connect(c.buyer).sellBack(id, bid * 99n / 100n);
  });

  it('only the owner of a pool-sold, live, open position can sell it back, once', async () => {
    const c = await deploy();
    const { id, exp } = await buyAtm(c);
    await expect(c.pool.connect(c.other).sellBack(id, 0n)).to.be.revertedWith('only long can sell back');
    await c.pool.connect(c.buyer).sellBack(id, 0n);
    await expect(c.pool.connect(c.buyer).sellBack(id, 0n)).to.be.revertedWith('no bid');   // already closed
    expect(await c.pool.quoteBuyback(id)).to.equal(0n);
    // expired
    const b = await buyAtm(c);
    await time.increaseTo(b.exp + 1); await c.oracle.setPrice(100000);
    expect(await c.pool.quoteBuyback(b.id)).to.equal(0n);
    await expect(c.pool.connect(c.buyer).sellBack(b.id, 0n)).to.be.revertedWith('no bid');
    // an open peer-to-peer order is not the pool's to buy back
    const e = (await now()) + 86400;
    await c.pool.connect(c.other).createShortOrder(1, K, Q, e, E18('50'));
    const p2p = (await c.pool.nextId()) - 1n;
    await expect(c.pool.connect(c.other).sellBack(p2p, 0n)).to.be.revertedWith('only long can sell back');
    expect(await c.pool.quoteBuyback(p2p)).to.equal(0n);
  });

  it('is blocked by the circuit breaker and by a pause, but exercising still works', async () => {
    const c = await deploy();
    await c.pool.setBreaker(600, 500, 1800);
    const { id } = await buyAtm(c);
    await c.pool.pokeCircuitBreaker();
    await c.oracle.setPrice(88000);                                     // -12% in the window: put is in the money
    await expect(c.pool.connect(c.buyer).sellBack(id, 0n)).to.be.revertedWith('circuit breaker');
    await c.pool.connect(c.buyer).settle(id);                           // exit via exercise is never blocked
    const d = await deploy();
    const e = await buyAtm(d);
    await d.pool.pausePool();
    await expect(d.pool.connect(d.buyer).sellBack(e.id, 0n)).to.be.revertedWith('paused');
  });

  it('charges the performance fee on yield recognised by the close, and accounting stays exact', async () => {
    const c = await deploy();
    const { id } = await buyAtm(c);
    await c.pool.connect(c.buyer).sellBack(id, 0n);
    const bal = await c.musd.balanceOf(await c.pool.getAddress());
    expect(bal).to.equal(await c.pool.totalAssets());                   // every MUSD in the contract is pool assets
    expect(await c.pool.totalSettlementsPaid()).to.be.gt(0n);
    expect(await c.pool.totalPerformanceFeePaid()).to.be.gt(0n);        // premium kept beyond the payout is yield
  });

  it('the pool profits on a round trip at the same price (buy at ask, sell at bid)', async () => {
    const c = await deploy();
    const { id, prem } = await buyAtm(c);
    const assets0 = await c.pool.totalAssets();                        // already includes the premium
    const bid = await c.pool.quoteBuyback(id);
    await c.pool.connect(c.buyer).sellBack(id, 0n);
    expect(prem - bid).to.be.gt(0n);
    expect(assets0 - (await c.pool.totalAssets())).to.be.gte(bid * 99n / 100n); // the payout comes out of pool assets
  });
});
