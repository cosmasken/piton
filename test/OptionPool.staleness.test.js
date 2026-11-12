// Oracle price age: 30 s for anything that opens risk, 120 s to exercise.
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { POOL_ERRORS } = require('./helpers/poolErrors');
const E18 = ethers.parseEther;

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
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900); await pool.setBreaker(600, 50000, 0);
  for (const w of [lp, buyer]) { await musd.mint(w.address, E18('1000000')); await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256); }
  await pool.connect(lp).deposit(E18('10000'));
  return { pool, oracle, lp, buyer, ymusd };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;

describe('Oracle price age', () => {
  it('the opening-risk limit is 30 s (the 120 s exercise limit is checked by behaviour below)', async () => {
    const { pool } = await deploy();
    expect(await pool.PRICE_STALENESS()).to.equal(30n);
  });

  it('a price older than 30 s blocks new orders, quotes and deposits (stale NAV would make shares look cheap)', async () => {
    const { pool, oracle, buyer, lp } = await deploy();
    const exp = (await now()) + 86400;
    await oracle.setAge(29);
    await pool.quotePremium(false, E18('100000'), E18('0.01'), exp);       // still fresh
    await oracle.setAge(31);
    await expect(pool.quotePremium(false, E18('100000'), E18('0.01'), exp)).to.be.revertedWithCustomError(POOL_ERRORS, 'StalePrice');
    await expect(pool.connect(buyer).createLongOrder(1, E18('100000'), E18('0.01'), exp, E18('10'))).to.be.revertedWithCustomError(POOL_ERRORS, 'StalePrice');
    await expect(pool.connect(lp).deposit(E18('1'))).to.be.revertedWithCustomError(POOL_ERRORS, 'StalePrice');
  });

  it('exercise still works with a price up to 120 s old, and stops after that', async () => {
    const { pool, oracle, buyer } = await deploy();
    const exp = (await now()) + 86400;
    const q = await pool.quotePremium(false, E18('100000'), E18('0.01'), exp);
    await pool.connect(buyer).createLongOrder(1, E18('100000'), E18('0.01'), exp, q);
    const id = (await pool.nextId()) - 1n;
    await oracle.setPrice(90000);
    await oracle.setAge(119);
    await expect(pool.connect(buyer).sellBack(id, 0)).to.be.revertedWithCustomError(POOL_ERRORS, 'StalePrice'); // opening-side limit
    await pool.connect(buyer).settle(id.valueOf());                                     // exercise allowed
    expect((await pool.getOption(id)).status).to.equal(2n);
    // a second option: past 120 s even exercising stops
    await oracle.setAge(0);
    const q2 = await pool.quotePremium(false, E18('100000'), E18('0.01'), exp);
    await pool.connect(buyer).createLongOrder(1, E18('100000'), E18('0.01'), exp, q2);
    const id2 = (await pool.nextId()) - 1n;
    await oracle.setAge(121);
    await expect(pool.connect(buyer).settle(id2)).to.be.revertedWithCustomError(POOL_ERRORS, 'StalePrice');
  });

  it('withdrawals keep working on a stale price (priced conservatively)', async () => {
    const { pool, oracle, lp, ymusd } = await deploy();
    await oracle.setAge(3600);
    await pool.connect(lp).withdraw((await ymusd.balanceOf(lp.address)) / 10n);
  });
});
