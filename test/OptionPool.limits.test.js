// Suggestions #3-#8: limits on what the pool will sell.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const E18 = ethers.parseEther;

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
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0);
  await pool.setTVLCap(E18('1000000000'));
  await pool.setMaxOptionCollateral(E18('10000000'));
  for (const w of [owner, lp, buyer, other]) {
    await musd.mint(w.address, E18('10000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  return { pool, musd, ymusd, oracle, owner, lp, buyer, other };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
// buy a put (strike K, qty Q) from the pool at the quote and report whether the pool filled it
async function buyPut(pool, buyer, K, Q, secs = 86400) {
  const exp = (await now()) + secs;
  const q = await pool.quotePremium(false, K, Q, exp);
  await pool.connect(buyer).createLongOrder(1, K, Q, exp, q * 101n / 100n);
  return (await pool.getOption((await pool.nextId()) - 1n)).filledByPool;
}

describe('#3 utilisation and single-option exposure limits', () => {
  it('defaults are 80% utilisation and 25% per option', async () => {
    const { pool } = await deploy();
    expect(await pool.maxUtilisationBps()).to.equal(8000n);
    expect(await pool.maxOptionExposureBps()).to.equal(2500n);
  });
  it('refuses one option that would lock more than 25% of the pool', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.03'))).to.equal(false); // 3,000 > 2,500
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.02'))).to.equal(true);  // 2,000 ok
  });
  it('refuses fills that would push total locked collateral past 80%', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));
    await pool.setRiskLimits(8000, 8000);
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.05'))).to.equal(true); // 5,000
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.03'))).to.equal(true); // 8,000 total (+premium raises assets)
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.01'))).to.equal(false); // would exceed 80%
  });
  it('an attacker cannot lock the whole pool with one cheap option', async () => {
    const { pool, lp, buyer, ymusd } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.01') * 1n, 86400 * 14)).to.equal(false); // 1,000 = 100% of the pool
    await pool.connect(lp).withdraw(await ymusd.balanceOf(lp.address));
  });
  it('limits are validated and owner-only', async () => {
    const { pool, lp } = await deploy();
    await expect(pool.setRiskLimits(0, 0)).to.be.revertedWith('bad limits');
    await expect(pool.setRiskLimits(10001, 2500)).to.be.revertedWith('bad limits');
    await expect(pool.setRiskLimits(2000, 3000)).to.be.revertedWith('bad limits');
    await expect(pool.setRiskLimits(9000, 3000)).to.emit(pool, 'RiskLimitsSet').withArgs(9000n, 3000n);
    await expect(pool.connect(lp).setRiskLimits(9000, 3000)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});
