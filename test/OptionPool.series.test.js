// Grouped liability: pool-sold options are priced per series (type, strike, expiry), so any number of options can
// share a series, the NAV loop runs over series, and the per-option exposure limit applies to the whole series.
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const E18 = ethers.parseEther, f = v => Number(ethers.formatEther(v));

async function deploy() {
  const [owner, lp, buyer] = await ethers.getSigners();
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
  for (const w of [owner, lp, buyer]) {
    await musd.mint(w.address, E18('100000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  await pool.connect(lp).deposit(E18('1000000'));
  return { pool, musd, ymusd, oracle, owner, lp, buyer };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
async function buy(c, { isCall = false, strike = E18('95000'), qty = E18('0.01'), exp }) {
  const prem = await c.pool.quotePremium(isCall, strike, qty, exp);
  await c.pool.connect(c.buyer).createLongOrder(isCall ? 0 : 1, strike, qty, exp, prem);
  const id = (await c.pool.nextId()) - 1n;
  const o = await c.pool.getOption(id);
  return { id, o, filledAt: await now() };
}
const liability = async pool => f(await pool.totalAssets()) - f(await pool.netAssetValue());

describe('Grouped liability (series)', () => {
  it('many options in one series all sell (beyond the series cap); one series is counted', async () => {
    const c = await deploy();
    await c.pool.setMaxOpenSeries(1);
    const exp = (await now()) + 86400;
    for (let i = 0; i < 60; i++) {
      const { o } = await buy(c, { exp, qty: E18('0.001') });
      expect(o.filledByPool).to.equal(true);
    }
    expect(await c.pool.openSeriesCount()).to.equal(1n);
    expect(await c.pool.openPoolOptionCount()).to.equal(60n);
    // another series is refused while the cap is 1
    const { o } = await buy(c, { exp, strike: E18('96000'), qty: E18('0.001') });
    expect(o.filledByPool).to.equal(false);
  });

  it('series liability equals the per-option sum: unearned premium decaying with sqrt(time), then exercise value', async () => {
    const c = await deploy();
    const exp = (await now()) + 2 * 86400;
    const fee = await c.pool.protocolFeeBps();
    const a = await buy(c, { exp });
    await time.increase(6 * 3600);
    const b = await buy(c, { exp, qty: E18('0.02') });             // same series, filled later: different lifetime
    await time.increase(9 * 3600);
    const t = await now();
    const net = o => f(o.premium - o.premium * fee / 10000n);
    // out of the money: liability = sum of premium x sqrt(time left / lifetime)
    const perOption = [a, b].reduce((sum, x) => sum + net(x.o) * Math.sqrt((exp - t) / (exp - x.filledAt)), 0);
    expect(await liability(c.pool)).to.be.closeTo(perOption, perOption * 1e-6 + 1e-9);
    // deep in the money: exercise value of the whole series (each option capped by its collateral)
    await c.oracle.setPrice(80_000);
    expect(await liability(c.pool)).to.be.closeTo((95000 - 80000) * 0.03, 1e-6);
    // after expiry: nothing is owed and the premium is earned
    await time.increase(2 * 86400);
    await c.oracle.setPrice(100_000);
    expect(await c.pool.netAssetValue()).to.equal(await c.pool.totalAssets());
  });

  it('the exposure limit applies to the whole series, so splitting an order does not get around it', async () => {
    const c = await deploy();
    await c.pool.setRiskLimits(8000, 100);                         // 1% of a 1M pool = 10,000 MUSD per series
    const exp = (await now()) + 86400;
    const K = E18('100000');                                       // put collateral = strike x size
    expect((await buy(c, { exp, strike: K, qty: E18('0.06') })).o.filledByPool).to.equal(true);   // 6,000
    expect((await buy(c, { exp, strike: K, qty: E18('0.03') })).o.filledByPool).to.equal(true);   // 9,000 in total
    expect((await buy(c, { exp, strike: K, qty: E18('0.02') })).o.filledByPool, 'would be 11,000').to.equal(false);
    expect(await c.pool.seriesCollateral(1, K, exp)).to.equal(E18('9000'));
    expect((await buy(c, { exp, strike: E18('99000'), qty: E18('0.02') })).o.filledByPool, 'another series has room').to.equal(true);
  });

  it('closing every option of a series (sell back, exercise, expiry) clears it exactly', async () => {
    const c = await deploy();
    const exp = (await now()) + 3600;
    const K = E18('100000');
    const x = await buy(c, { exp, strike: K }), y = await buy(c, { exp, strike: K }), z = await buy(c, { exp, strike: K });
    expect(await c.pool.openSeriesCount()).to.equal(1n);
    await c.pool.connect(c.buyer).sellBack(x.id, 0);
    await time.increase(60); await c.oracle.setPrice(99_000);       // in the money
    await c.pool.connect(c.buyer).settle(y.id);
    await time.increase(3600);
    await c.pool.refund(z.id);
    expect(await c.pool.openSeriesCount()).to.equal(0n);
    expect(await c.pool.openPoolOptionCount()).to.equal(0n);
    expect(await c.pool.seriesCollateral(1, K, exp)).to.equal(0n);
    expect(await c.pool.lockedCollateral()).to.equal(0n);
    expect(await c.pool.unrecognizedPremium()).to.equal(0n);
    expect(await c.pool.netAssetValue()).to.equal(await c.pool.totalAssets());
  });
});
