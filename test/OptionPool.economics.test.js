// Economic-safety tests: nobody (buyer, LP, or the fee recipient) can extract value from the pool
// without taking real risk. Each test targets a specific attack.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const E18 = ethers.parseEther;

async function deploy() {
  const [owner, lp, buyer, seller, lp2] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const trove = await (await ethers.getContractFactory('MockTrove')).deploy();
  const bo = await (await ethers.getContractFactory('MockBorrowerOps')).deploy();
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await ethers.getContractFactory('OptionPool')).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(), await trove.getAddress(), await bo.getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900); await pool.setBreaker(600, 50000, 0); // exit protections have their own tests
  for (const w of [owner, lp, buyer, seller, lp2]) {
    await musd.mint(w.address, E18('10000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  await pool.setTVLCap(E18('100000000'));
  await pool.setMaxOptionCollateral(E18('1000000'));
  return { pool, musd, ymusd, oracle, owner, lp, buyer, seller, lp2 };
}
const expiry = async s => (await ethers.provider.getBlock('latest')).timestamp + s;
const lastId = async pool => (await pool.nextId()) - 1n;
const filled = async (pool, id) => (await pool.getOption(id)).filledByPool;

// ─────────────────────────────────────────────────────────────────────────────
describe('Economics: no buying below immediate-exercise value', () => {
  const QTY = E18('0.1'); // keeps collateral well inside the pool

  it('deep in-the-money call: the quote fills, but 95% of it (below exercise value) is rejected', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('100000'));
    const exp = await expiry(16 * 60);
    const strike = E18('95000'); // $5,000 in the money -> $500 for 0.1 BTC
    const q = await pool.quotePremium(true, strike, QTY, exp);
    expect(q).to.be.gte(E18('500') * 10000n / 9800n); // at least exercise value grossed up for the 2% fee

    await pool.connect(buyer).createLongOrder(0, strike, QTY, exp, q);
    expect(await filled(pool, await lastId(pool)), 'quote is accepted').to.equal(true);

    // the old rule (95% of the price) accepted this and let the buyer exercise for a profit
    await pool.connect(buyer).createLongOrder(0, strike, QTY, exp, q * 95n / 100n);
    expect(await filled(pool, await lastId(pool)), '95% of quote is rejected').to.equal(false);
  });

  it('buy at the quote then exercise in the same block: buyer gains nothing, LPs lose nothing', async () => {
    const { pool, musd, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('100000'));
    for (const [isCall, strike] of [[true, '99000'], [true, '95000'], [false, '101000'], [false, '110000']]) {
      const exp = await expiry(16 * 60);
      const q = await pool.quotePremium(isCall, E18(strike), QTY, exp);
      const assetsBefore = await pool.totalAssets();
      const buyerBefore = await musd.balanceOf(buyer.address);
      await pool.connect(buyer).createLongOrder(isCall ? 0 : 1, E18(strike), QTY, exp, q);
      const id = await lastId(pool);
      expect(await filled(pool, id), `${isCall ? 'call' : 'put'} ${strike} filled`).to.equal(true);
      await pool.connect(buyer).settle(id);
      expect(await musd.balanceOf(buyer.address), `${isCall ? 'call' : 'put'} ${strike}: buyer did not profit`).to.be.lte(buyerBefore);
      expect(await pool.totalAssets(), `${isCall ? 'call' : 'put'} ${strike}: LPs did not lose`).to.be.gte(assetsBefore);
    }
  });

  it('deep in-the-money 14-day put is quoted at or above exercise value (no early-exercise gap)', async () => {
    const { pool } = await deploy();
    const exp = await expiry(14 * 86400);
    const q = await pool.quotePremium(false, E18('150000'), E18('1'), exp); // $50k in the money
    expect(q).to.be.gte(E18('50000') * 10000n / 9800n);
  });

  it('the fee recipient cannot drain LPs by wash-trading in-the-money options', async () => {
    const { pool, musd, owner, lp } = await deploy(); // the owner is also the fee recipient
    await pool.connect(lp).deposit(E18('100000'));
    const assetsBefore = await pool.totalAssets();
    const ownerBefore = await musd.balanceOf(owner.address);
    for (let i = 0; i < 5; i++) {
      const exp = await expiry(16 * 60);
      const q = await pool.quotePremium(true, E18('95000'), QTY, exp);
      await pool.connect(owner).createLongOrder(0, E18('95000'), QTY, exp, q);
      await pool.connect(owner).settle(await lastId(pool));
    }
    expect(await musd.balanceOf(owner.address), 'owner did not profit').to.be.lte(ownerBefore);
    expect(await pool.totalAssets(), 'LPs did not lose').to.be.gte(assetsBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Economics: LP shares priced net of open-option liability', () => {
  async function poolWithItmPut() {
    const ctx = await deploy();
    const { pool, oracle, lp, lp2, buyer } = ctx;
    await pool.connect(lp).deposit(E18('50000'));
    await pool.connect(lp2).deposit(E18('50000'));
    const exp = await expiry(86400);
    const q = await pool.quotePremium(false, E18('100000'), E18('0.2'), exp);
    await pool.connect(buyer).createLongOrder(1, E18('100000'), E18('0.2'), exp, q); // pool sells a 0.2 BTC put
    await oracle.setPrice(80000); // the put now owes (100k - 80k) * 0.2 = 4,000
    return { ...ctx, id: await lastId(pool) };
  }

  it('NAV = assets minus what open options would pay now', async () => {
    const { pool } = await poolWithItmPut();
    expect(await pool.netAssetValue()).to.equal((await pool.totalAssets()) - E18('4000'));
  });

  it('an LP leaving before a known loss takes their share of it (remaining LP not diluted)', async () => {
    const { pool, ymusd, musd, lp, lp2, buyer, id } = await poolWithItmPut();
    const navPerShareBefore = (await pool.netAssetValue()) * E18('1') / (await ymusd.totalSupply());
    const shares = await ymusd.balanceOf(lp.address);
    const before = await musd.balanceOf(lp.address);
    await pool.connect(lp).withdraw(shares);
    const got = (await musd.balanceOf(lp.address)) - before;
    expect(got).to.be.closeTo(shares * navPerShareBefore / E18('1'), 10n ** 6n); // at NAV, not inflated assets
    await pool.connect(buyer).settle(id); // the loss materialises
    const navPerShareAfter = (await pool.netAssetValue()) * E18('1') / (await ymusd.totalSupply());
    expect(navPerShareAfter).to.be.closeTo(navPerShareBefore, 10n ** 6n); // remaining LP kept the same value
    expect(await ymusd.balanceOf(lp2.address)).to.be.gt(0n);
  });

  it('a new depositor buys in at NAV, not at inflated assets', async () => {
    const { pool, ymusd, seller, buyer, id } = await poolWithItmPut();
    const navPerShare = (await pool.netAssetValue()) * E18('1') / (await ymusd.totalSupply());
    await pool.connect(seller).deposit(E18('10000'));
    const shares = await ymusd.balanceOf(seller.address);
    expect(shares).to.be.closeTo(E18('10000') * E18('1') / navPerShare, 10n ** 6n);
    await pool.connect(buyer).settle(id);
    const worth = shares * (await pool.netAssetValue()) / (await ymusd.totalSupply());
    expect(worth).to.be.closeTo(E18('10000'), E18('0.001')); // still worth what they paid after the loss
  });

  it('stale oracle: NAV assumes full collateral owed, and withdrawals still work', async () => {
    const { pool, ymusd, oracle, lp } = await poolWithItmPut();
    await oracle.setStale();
    expect(await pool.netAssetValue()).to.equal((await pool.totalAssets()) - (await pool.lockedCollateral()));
    const shares = await ymusd.balanceOf(lp.address);
    await expect(pool.connect(lp).withdraw(shares / 2n)).to.not.be.reverted;
  });

  it('expired, unexercised options no longer count as liability', async () => {
    const { pool } = await poolWithItmPut();
    await time.increase(86401);
    expect(await pool.netAssetValue()).to.equal(await pool.totalAssets());
  });

  it('open-option set is capped, and frees up on refund', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('5000000'));
    const exp = await expiry(3600);
    const max = Number(await pool.MAX_OPEN_POOL_OPTIONS());
    const q = await pool.quotePremium(false, E18('90000'), E18('0.001'), exp); // tiny: rent floor dominates
    for (let i = 0; i < max; i++) await pool.connect(buyer).createLongOrder(1, E18('90000'), E18('0.001'), exp, q);
    expect(await pool.openPoolOptionCount()).to.equal(BigInt(max));
    await pool.connect(buyer).createLongOrder(1, E18('90000'), E18('0.001'), exp, q);
    expect(await filled(pool, await lastId(pool)), 'cap reached: rests as a bid').to.equal(false);
    await time.increase(3601);
    await pool.refund(1);
    expect(await pool.openPoolOptionCount()).to.equal(BigInt(max - 1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Economics: performance fee is never retroactive', () => {
  const Q = E18('0.1');

  /** n worthless options: premiums credited at fill, then all refunded after expiry. */
  async function earnYield(ctx, n = 3) {
    const { pool, buyer } = ctx;
    for (let i = 0; i < n; i++) {
      const exp = await expiry(3600);
      const q = await pool.quotePremium(false, E18('99000'), Q, exp);
      await pool.connect(buyer).createLongOrder(1, E18('99000'), Q, exp, q);
    }
    await time.increase(3601);
    const last = await lastId(pool);
    for (let id = last - BigInt(n) + 1n; id <= last; id++) await pool.refund(id);
  }
  const netYield = async pool => (await pool.totalPremiumsEarned()) - (await pool.totalSettlementsPaid());

  it('yield earned at 15% stays charged at 15% after the rate is raised to 30%', async () => {
    const ctx = await deploy();
    const { pool, lp } = ctx;
    await pool.connect(lp).deposit(E18('100000'));
    await earnYield(ctx);
    const y1 = await netYield(pool);
    expect(y1).to.be.gt(0n);
    const fee1 = await pool.totalPerformanceFeePaid();
    expect(fee1).to.be.closeTo(y1 * 1500n / 10000n, 4n);

    await pool.setPerformanceFeeBps(3000);
    expect(await pool.totalPerformanceFeePaid(), 'raising the rate charged nothing extra').to.equal(fee1);

    await earnYield(ctx, 2);
    const y2 = await netYield(pool);
    // only the NEW yield is charged at 30%
    expect(await pool.totalPerformanceFeePaid()).to.be.closeTo(y1 * 1500n / 10000n + (y2 - y1) * 3000n / 10000n, 4n);
  });

  it('premium of options still open is not charged; a rate change applies when the yield is earned', async () => {
    const ctx = await deploy();
    const { pool, lp, buyer } = ctx;
    await pool.connect(lp).deposit(E18('100000'));
    for (let i = 0; i < 3; i++) { // premiums are booked at fill, but the options are still open
      const exp = await expiry(3600);
      const q = await pool.quotePremium(false, E18('99000'), Q, exp);
      await pool.connect(buyer).createLongOrder(1, E18('99000'), Q, exp, q);
    }
    expect(await pool.totalPerformanceFeePaid(), 'nothing earned yet').to.equal(0n);
    await pool.setPerformanceFeeBps(3000);
    expect(await pool.totalPerformanceFeePaid(), 'a rate change charges nothing by itself').to.equal(0n);
    await time.increase(3601);
    for (let id = 1n; id <= 3n; id++) await pool.refund(id);
    const y = await netYield(pool);
    expect(await pool.totalPerformanceFeePaid(), 'charged at the rate in force when earned').to.be.closeTo(y * 3000n / 10000n, 4n);
  });

  it('no fee is charged while the pool is below its high-water mark, then only on new yield', async () => {
    const ctx = await deploy();
    const { pool, oracle, lp, buyer } = ctx;
    await pool.connect(lp).deposit(E18('100000'));
    await earnYield(ctx);
    const feeAfterYield = await pool.totalPerformanceFeePaid();
    const hw = await pool.perfFeeHighWater();
    expect(hw).to.equal(await netYield(pool));

    // a losing option: pays out far more than all premiums so far
    const exp = await expiry(3600);
    const q = await pool.quotePremium(false, E18('100000'), Q, exp);
    await pool.connect(buyer).createLongOrder(1, E18('100000'), Q, exp, q);
    await oracle.setPrice(90000);
    await pool.connect(buyer).settle(await lastId(pool)); // pays (100k-90k)*0.1 = 1,000
    expect(await pool.totalPerformanceFeePaid(), 'no fee on a losing period').to.equal(feeAfterYield);
    expect(await pool.perfFeeHighWater(), 'high-water mark never moves down').to.equal(hw);

    // new premium below the old high-water mark is still fee-free
    await oracle.setPrice(100000);
    await earnYield(ctx, 2);
    expect(await netYield(pool)).to.be.lt(hw);
    expect(await pool.totalPerformanceFeePaid(), 'no fee until losses are recovered').to.equal(feeAfterYield);
  });
});
