// Suggestions #3-#8: limits on what the pool will sell.
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { POOL_ERRORS } = require('./helpers/poolErrors');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, lp, buyer, other] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await poolFactory()).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900); await pool.setBreaker(600, 50000, 0);
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
    await expect(pool.setRiskLimits(0, 0)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadLimits');
    await expect(pool.setRiskLimits(10001, 2500)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadLimits');
    await expect(pool.setRiskLimits(2000, 3000)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadLimits');
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
    await expect(pool.setMinRentBps(5001)).to.be.revertedWithCustomError(POOL_ERRORS, 'Max50Pct');
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
    await expect(pool.setMaxStrikeDistanceBps(999)).to.be.revertedWithCustomError(POOL_ERRORS, 'Between10PctAnd100Pct');
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
    await expect(pool.setMinPoolExpiry(899)).to.be.revertedWithCustomError(POOL_ERRORS, 'OutOfRange');
    await expect(pool.setMinPoolExpiry(7 * 86400 + 1)).to.be.revertedWithCustomError(POOL_ERRORS, 'OutOfRange');
    await expect(pool.setMinPoolExpiry(1800)).to.emit(pool, 'MinPoolExpirySet').withArgs(1800n);
    await expect(pool.connect(lp).setMinPoolExpiry(1800)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    const fresh = await (await poolFactory()).deploy(
      ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address);
    expect(await fresh.minPoolExpiry()).to.equal(3600n);
  });
});

describe('#6 utilisation-based price markup', () => {
  const quote = (pool, Q, K = E18('100000')) =>
    now().then(t => pool.quotePremium(false, K, Q, t + 86400));
  it('a busier pool and a bigger trade cost more per BTC', async () => {
    const { pool, lp } = await deploy();
    await pool.connect(lp).deposit(E18('100000'));
    const small = (await quote(pool, E18('0.01'))) * 80n;   // 1,000 collateral = 1% of pool
    const big   = await quote(pool, E18('0.8'));            // 80,000 collateral = 80% of pool
    expect(big).to.be.gt(small * 108n / 100n);              // markup 0.2 * 0.64 = 12.8% of IV
  });
  it('with the markup off the per-BTC price does not depend on size', async () => {
    const { pool, lp } = await deploy();
    await pool.setUtilSpreadBps(0);
    await pool.connect(lp).deposit(E18('100000'));
    const small = (await quote(pool, E18('0.01'))) * 80n;
    const big   = await quote(pool, E18('0.8'));
    expect(big).to.be.closeTo(small, small / 200n);
  });
  it('existing locked collateral raises the next quote', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('100000'));
    const before = await quote(pool, E18('0.01'));
    await pool.setRiskLimits(8000, 8000);
    expect(await buyPut(pool, buyer, E18('100000'), E18('0.7'))).to.equal(true);
    expect(await quote(pool, E18('0.01'))).to.be.gt(before);
  });
  it('is capped at 100% spread and owner-only', async () => {
    const { pool, lp } = await deploy();
    expect(await pool.utilSpreadBps()).to.equal(2000n);
    await expect(pool.setUtilSpreadBps(10001)).to.be.revertedWithCustomError(POOL_ERRORS, 'SpreadTooHigh');
    await expect(pool.setUtilSpreadBps(500)).to.emit(pool, 'UtilSpreadSet').withArgs(500n);
    await expect(pool.connect(lp).setUtilSpreadBps(1)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});

describe('#8 circuit breaker', () => {
  async function armed() {
    const c = await deploy();
    await c.pool.setBreaker(600, 500, 1800); // 5% in 10 min -> 30 min pause (the shipped defaults)
    await c.pool.connect(c.lp).deposit(E18('1000000'));
    await c.pool.pokeCircuitBreaker();       // start the window at 100,000
    return c;
  }
  it('a fast move pauses pool fills (orders rest as bids) and deposits; exits keep working', async () => {
    const { pool, oracle, lp, buyer, other, ymusd } = await armed();
    await oracle.setPrice(93000); // -7% inside the window
    expect(await buyPut(pool, buyer, E18('90000'), E18('0.1'))).to.equal(false);
    expect(await pool.cbUntil()).to.be.gt(0n);
    await expect(pool.connect(other).deposit(E18('10'))).to.be.revertedWithCustomError(POOL_ERRORS, 'CircuitBreaker');
    await pool.connect(lp).withdraw((await ymusd.balanceOf(lp.address)) / 10n); // LPs can always leave
  });
  it('pool fills and deposits resume after the cooldown', async () => {
    const { pool, oracle, buyer, other } = await armed();
    await oracle.setPrice(93000);
    expect(await buyPut(pool, buyer, E18('90000'), E18('0.1'))).to.equal(false);
    await time.increase(1801); await oracle.setPrice(93000);
    expect(await buyPut(pool, buyer, E18('90000'), E18('0.1'))).to.equal(true);
    await pool.connect(other).deposit(E18('10'));
  });
  it('a slow drift of the same size does not trip it', async () => {
    const { pool, oracle, buyer } = await armed();
    for (const p of [98000, 96000, 94000]) { await time.increase(400); await oracle.setPrice(p); expect(await buyPut(pool, buyer, E18('90000'), E18('0.1'))).to.equal(true); }
  });
  it('anyone can poke it with a fresh price; settle and refund are never blocked', async () => {
    const { pool, oracle, buyer } = await armed();
    expect(await buyPut(pool, buyer, E18('99000'), E18('0.1'))).to.equal(true);
    const id = (await pool.nextId()) - 1n;
    await oracle.setPrice(90000);
    await pool.pokeCircuitBreaker();
    expect(await pool.cbUntil()).to.be.gt(0n);
    await pool.connect(buyer).settle(id); // exercising during a breaker is fine
  });
  it('settings are bounded and owner-only', async () => {
    const { pool, lp } = await deploy();
    await expect(pool.setBreaker(30, 500, 1800)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadWindow');
    await expect(pool.setBreaker(600, 50, 1800)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadMove');
    await expect(pool.setBreaker(600, 500, 86401)).to.be.revertedWithCustomError(POOL_ERRORS, 'BadCooldown');
    await expect(pool.setBreaker(600, 500, 1800)).to.emit(pool, 'BreakerSet').withArgs(600n, 500n, 1800n);
    await expect(pool.connect(lp).setBreaker(600, 500, 1800)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    expect(await pool.cbMaxMoveBps()).to.equal(500n);
  });
});

describe('#9 auto-exercise', () => {
  async function itmPut() {
    const c = await deploy();
    await c.pool.connect(c.lp).deposit(E18('1000000'));
    expect(await buyPut(c.pool, c.buyer, E18('100000'), E18('0.1'), 3600)).to.equal(true);
    const id = (await c.pool.nextId()) - 1n;
    return { ...c, id, exp: Number((await c.pool.getOption(id)).expiry) };
  }
  it('a keeper exercises an opted-in ITM option in the last 5 minutes and earns 0.5%', async () => {
    const { pool, oracle, musd, buyer, other, id, exp } = await itmPut();
    await pool.connect(buyer).setAutoExercise(id, true);
    await oracle.setPrice(90000); // put is 10,000 ITM per BTC -> 1,000 payout
    await expect(pool.connect(other).settleFor(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'NotInExerciseWindow');
    await time.increaseTo(exp - 200); await oracle.setPrice(90000);
    const b = await musd.balanceOf(buyer.address), k = await musd.balanceOf(other.address);
    await pool.connect(other).settleFor(id);
    expect((await musd.balanceOf(buyer.address)) - b).to.equal(E18('995'));
    expect((await musd.balanceOf(other.address)) - k).to.equal(E18('5'));
    expect((await pool.getOption(id)).status).to.equal(2n); // SETTLED
  });
  it('does nothing unless the owner opted in; only the owner can opt in', async () => {
    const { pool, oracle, buyer, other, id, exp } = await itmPut();
    await time.increaseTo(exp - 200); await oracle.setPrice(90000);
    await expect(pool.connect(other).settleFor(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'AutoExerciseNotEnabled');
    await expect(pool.connect(other).setAutoExercise(id, true)).to.be.revertedWithCustomError(POOL_ERRORS, 'NotYourOpenOption');
    await pool.connect(buyer).setAutoExercise(id, true);
    await pool.connect(buyer).setAutoExercise(id, false);
    await expect(pool.connect(other).settleFor(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'AutoExerciseNotEnabled');
  });
  it('refuses out-of-the-money options and options already past expiry', async () => {
    const { pool, oracle, buyer, other, id, exp } = await itmPut();
    await pool.connect(buyer).setAutoExercise(id, true);
    await time.increaseTo(exp - 200);
    await oracle.setPrice(110000);
    await expect(pool.connect(other).settleFor(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'NotInTheMoney');
    await time.increaseTo(exp + 1); await oracle.setPrice(90000);
    await expect(pool.connect(other).settleFor(id)).to.be.revertedWithCustomError(POOL_ERRORS, 'NotInExerciseWindow');
  });
  it('manual settle still works as before and the fee is capped', async () => {
    const { pool, oracle, musd, buyer, id } = await itmPut();
    await oracle.setPrice(90000);
    const b = await musd.balanceOf(buyer.address);
    await pool.connect(buyer).settle(id);
    expect((await musd.balanceOf(buyer.address)) - b).to.equal(E18('1000'));
    await expect(pool.setKeeperFeeBps(201)).to.be.revertedWithCustomError(POOL_ERRORS, 'Max2Pct');
    await expect(pool.setKeeperFeeBps(100)).to.emit(pool, 'KeeperFeeSet').withArgs(100n);
  });
});

describe('#12 open-series cap and worst-case gas', () => {
  it('cap is adjustable within 1..150 by the owner', async () => {
    const { pool, lp } = await deploy();
    expect(await pool.maxOpenSeries()).to.equal(50n);
    await expect(pool.setMaxOpenSeries(0)).to.be.revertedWithCustomError(POOL_ERRORS, 'OutOfRange');
    await expect(pool.setMaxOpenSeries(151)).to.be.revertedWithCustomError(POOL_ERRORS, 'OutOfRange');
    await expect(pool.setMaxOpenSeries(150)).to.emit(pool, 'MaxOpenSeriesSet').withArgs(150n);
    await expect(pool.connect(lp).setMaxOpenSeries(10)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
  it('deposit and withdraw stay far below the block gas limit with 150 open series (half of Mezo\'s 10M block limit)', async function () {
    this.timeout(600000);
    const { pool, ymusd, lp, buyer, other } = await deploy();
    await pool.setMaxOpenSeries(150);
    await pool.setTVLCap(E18('1000000000'));
    await pool.connect(lp).deposit(E18('5000000'));
    const exp = (await now()) + 86400;
    const K = i => E18(String(90000 + i * 50));
    for (let i = 0; i < 150; i++) {
      const q = await pool.quotePremium(false, K(i), E18('0.001'), exp);
      await pool.connect(buyer).createLongOrder(1, K(i), E18('0.001'), exp, q);
    }
    expect(await pool.openSeriesCount()).to.equal(150n);
    const q = await pool.quotePremium(false, K(150), E18('0.001'), exp);
    await pool.connect(buyer).createLongOrder(1, K(150), E18('0.001'), exp, q);
    expect((await pool.getOption((await pool.nextId()) - 1n)).filledByPool, 'cap holds at 150 series').to.equal(false);
    const dep = await (await pool.connect(other).deposit(E18('1000'))).wait();
    await time.increase(1); // pass the withdraw check on a fresh block
    const wd = await (await pool.connect(lp).withdraw((await ymusd.balanceOf(lp.address)) / 100n)).wait();
    console.log(`      gas with 150 open series: deposit ${dep.gasUsed}, withdraw ${wd.gasUsed}`);
    expect(dep.gasUsed).to.be.lt(5_000_000n);
    expect(wd.gasUsed).to.be.lt(5_000_000n);
  });
});

