// Suggestion #2: deposit lock + withdrawal fee while options are open.
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { POOL_ERRORS } = require('./helpers/poolErrors');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, lp, buyer, friend] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await poolFactory()).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setTVLCap(E18('1000000000'));
  await pool.setMaxOptionCollateral(E18('10000000'));
  for (const w of [owner, lp, buyer, friend]) {
    await musd.mint(w.address, E18('1000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  return { pool, musd, ymusd, oracle, owner, lp, buyer, friend };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;

describe('Exit protections (deposit lock, withdrawal fee)', () => {
  it('defaults: 25 bps fee and a 1 hour lock', async () => {
    const { pool } = await deploy();
    expect(await pool.withdrawalFeeBps()).to.equal(25n);
    expect(await pool.depositLockSeconds()).to.equal(3600n);
  });

  it('blocks withdrawal until the lock ends', async () => {
    const { pool, ymusd, lp } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    const sh = (await ymusd.balanceOf(lp.address)) / 4n;
    await expect(pool.connect(lp).withdraw(sh)).to.be.revertedWithCustomError(POOL_ERRORS, 'DepositLocked');
    await time.increase(3601);
    await pool.connect(lp).withdraw(sh);
  });

  it('blocks moving yMUSD during the lock, so it cannot be dodged with a fresh address', async () => {
    const { pool, ymusd, lp, friend } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    await expect(ymusd.connect(lp).transfer(friend.address, 1n)).to.be.revertedWith('yMUSD: deposit locked');
    await time.increase(3601);
    await ymusd.connect(lp).transfer(friend.address, 1n);
  });

  it('a fresh deposit re-locks the depositor', async () => {
    const { pool, ymusd, lp } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    await time.increase(3601);
    await pool.connect(lp).deposit(E18('1'));
    await expect(pool.connect(lp).withdraw(1n)).to.be.revertedWithCustomError(POOL_ERRORS, 'DepositLocked');
  });

  it('charges the fee only while pool options are open, and the fee stays in the pool', async () => {
    const { pool, ymusd, musd, lp, buyer, friend } = await deploy();
    await pool.setRiskLimits(10000, 10000); // this test is not about the exposure limits
    await pool.setDepositLock(0);
    await pool.connect(lp).deposit(E18('1000'));
    await pool.connect(friend).deposit(E18('1000'));
    // no open options: no fee
    const b0 = await musd.balanceOf(friend.address);
    const half = (await ymusd.balanceOf(friend.address)) / 2n;
    await pool.connect(friend).withdraw(half);
    expect((await musd.balanceOf(friend.address)) - b0).to.equal(E18('500'));

    const exp = (await now()) + 86400;
    const q = await pool.quotePremium(false, E18('100000'), E18('0.01'), exp);
    await pool.connect(buyer).createLongOrder(1, E18('100000'), E18('0.01'), exp, q);
    expect(await pool.openPoolOptionCount()).to.equal(1n);

    const navPer = await pool.netAssetValue() * E18('1') / await ymusd.totalSupply();
    const sh = (await ymusd.balanceOf(lp.address)) / 4n;
    const before = await musd.balanceOf(lp.address);
    const taEarlier = await pool.totalAssets();
    await pool.connect(lp).withdraw(sh);
    const got = (await musd.balanceOf(lp.address)) - before;
    const gross = sh * navPer / E18('1');
    expect(got).to.be.closeTo(gross * 9975n / 10000n, E18('0.0001'));
    // the 25 bps stayed behind in totalAssets
    expect(taEarlier - (await pool.totalAssets())).to.be.closeTo(got, 1n);
  });

  it('owner can tune within bounds and each change emits an event', async () => {
    const { pool, lp } = await deploy();
    await expect(pool.setWithdrawalFeeBps(100)).to.emit(pool, 'WithdrawalFeeSet').withArgs(100n);
    await expect(pool.setWithdrawalFeeBps(101)).to.be.revertedWithCustomError(POOL_ERRORS, 'Max1Pct');
    await expect(pool.setDepositLock(7 * 86400)).to.emit(pool, 'DepositLockSet');
    await expect(pool.setDepositLock(7 * 86400 + 1)).to.be.revertedWithCustomError(POOL_ERRORS, 'Max7Days');
    await expect(pool.connect(lp).setDepositLock(0)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});
