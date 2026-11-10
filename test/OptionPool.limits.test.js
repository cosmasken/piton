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
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900);
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

describe('#4 minimum rent on locked collateral', () => {
  it('default is 5% a year of the collateral', async () => {
    const { pool } = await deploy();
    expect(await pool.minRentBps()).to.equal(500n);
  });
  it('a nearly-free far-OTM long-dated put is no longer sold for dust', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('1000000'));
    const K = E18('75000'), Q = E18('1'), exp = (await now()) + 14 * 86400;
    const bsOnly = await pool.quotePremium(false, K, Q, exp);
    const rent = K * 500n * BigInt(14 * 86400) / (10000n * 31536000n);
    expect(bsOnly).to.be.gte(rent - 10n * 10n ** 15n); // the quote is at least the rent (60k collateral * 5% * 14d)
    // offering 1 wei: not filled by the pool
    await pool.connect(buyer).createLongOrder(1, K, Q, exp, 1n);
    expect((await pool.getOption(await pool.nextId() - 1n)).filledByPool).to.equal(false);
    // offering the quote: filled
    await pool.connect(buyer).createLongOrder(1, K, Q, exp, bsOnly);
    expect((await pool.getOption(await pool.nextId() - 1n)).filledByPool).to.equal(true);
  });
  it('owner can set it to zero (floor off) and it is capped at 50%', async () => {
    const { pool, lp } = await deploy();
    await expect(pool.setMinRentBps(0)).to.emit(pool, 'MinRentSet').withArgs(0n);
    await expect(pool.setMinRentBps(5001)).to.be.revertedWith('max 50%');
    await expect(pool.connect(lp).setMinRentBps(1)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});

describe('#5 strike distance band', () => {
  it('default 30%: the pool declines strikes further from spot than that', async () => {
    const { pool, lp, buyer } = await deploy();
    expect(await pool.maxStrikeDistanceBps()).to.equal(3000n);
    await pool.connect(lp).deposit(E18('1000000'));
    expect(await buyPut(pool, buyer, E18('68000'), E18('0.1'))).to.equal(false); // 32% below
    expect(await buyPut(pool, buyer, E18('72000'), E18('0.1'))).to.equal(true);  // 28% below
    const exp = (await now()) + 86400;
    const q = await pool.quotePremium(true, E18('135000'), E18('0.1'), exp);
    await pool.connect(buyer).createLongOrder(0, E18('135000'), E18('0.1'), exp, q * 2n);
    expect((await pool.getOption(await pool.nextId() - 1n)).filledByPool).to.equal(false); // calls too: 35% above
  });
  it('owner can widen (10%..100%) and it emits', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('1000000'));
    await expect(pool.setMaxStrikeDistanceBps(5000)).to.emit(pool, 'MaxStrikeDistanceSet').withArgs(5000n);
    expect(await buyPut(pool, buyer, E18('60000'), E18('0.1'))).to.equal(true);
    await expect(pool.setMaxStrikeDistanceBps(999)).to.be.revertedWith('between 10% and 100%');
    await expect(pool.connect(lp).setMaxStrikeDistanceBps(5000)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});

describe('#7 minimum time left for pool-sold options', () => {
  it('default is 1 hour; shorter options rest as open bids instead of being sold by the pool', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.setMinPoolExpiry(3600);
    await pool.connect(lp).deposit(E18('1000000'));
    expect(await buyPut(pool, buyer, E18('95000'), E18('0.1'), 1800)).to.equal(false);
    expect(await buyPut(pool, buyer, E18('95000'), E18('0.1'), 3700)).to.equal(true);
  });
  it('fresh deployment defaults to 1 hour; owner range is 15 min .. 7 days', async () => {
    const [o] = await ethers.getSigners();
    const { pool, lp } = await deploy();
    await expect(pool.setMinPoolExpiry(899)).to.be.revertedWith('out of range');
    await expect(pool.setMinPoolExpiry(7 * 86400 + 1)).to.be.revertedWith('out of range');
    await expect(pool.setMinPoolExpiry(1800)).to.emit(pool, 'MinPoolExpirySet').withArgs(1800n);
    await expect(pool.connect(lp).setMinPoolExpiry(1800)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    const fresh = await (await ethers.getContractFactory('OptionPool')).deploy(
      ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address);
    expect(await fresh.minPoolExpiry()).to.equal(3600n);
  });
});
