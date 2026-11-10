const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time }   = require('@nomicfoundation/hardhat-network-helpers');

const E18 = ethers.parseEther;
const BTC_PRICE = 100_000;

async function deploy() {
  const [owner, lp, buyer, seller, other] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory('MockERC20v2');
  const musd = await MockERC20.deploy('MUSD', 'MUSD');

  const MockOracle = await ethers.getContractFactory('MockOracle');
  const oracle = await MockOracle.deploy(BTC_PRICE);

  const MockTrove = await ethers.getContractFactory('MockTrove');
  const trove = await MockTrove.deploy();

  const MockBorrowerOps = await ethers.getContractFactory('MockBorrowerOps');
  const borrowerOps = await MockBorrowerOps.deploy();

  const YMUSD = await ethers.getContractFactory('yMUSD');
  const ymusd = await YMUSD.deploy();

  const Pool = await ethers.getContractFactory('OptionPool');
  const pool = await Pool.deploy(
    await musd.getAddress(),
    await ymusd.getAddress(),
    await oracle.getAddress(),
    await trove.getAddress(),
    await borrowerOps.getAddress()
  );

  await ymusd.setPool(await pool.getAddress());

  for (const w of [lp, buyer, seller]) {
    await musd.mint(w.address, E18('100000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }

  // Pre-fund the mock BorrowerOperations so the Trove pull can pay the pool.
  await musd.mint(await borrowerOps.getAddress(), E18('100000'));
  await borrowerOps.setMUSD(await musd.getAddress());

  return { pool, musd, ymusd, oracle, trove, borrowerOps, owner, lp, buyer, seller, other };
}

async function expiry(seconds) {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp + seconds;
}

describe('Audit guards', () => {
  it('rejects a dust first deposit (inflation attack guard)', async () => {
    const { pool, lp } = await deploy();
    await expect(pool.connect(lp).deposit(1n))
      .to.be.revertedWith('min deposit 0.001 MUSD');
  });

  it('rejects a manual short above max option collateral', async () => {
    const { pool, seller } = await deploy();
    const exp = await expiry(3600);
    // put collateral = strike * qty = 100k MUSD > 10k cap
    await expect(
      pool.connect(seller).createShortOrder(1, E18('100000'), E18('1'), exp, E18('100'))
    ).to.be.revertedWith('collateral exceeds max');
  });
});

describe('Payout accounting', () => {
  it('caps pool payout at the locked collateral (profit overflow)', async () => {
    const { pool, musd, oracle, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike = E18('50000');
    const qty    = E18('0.05');
    const exp    = await expiry(3600);
    const quote  = await pool.quotePremium(true, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(0, strike, qty, exp, quote + E18('1'));
    const id = (await pool.nextId()) - 1n;
    const o  = await pool.getOption(id);
    expect(o.filledByPool).to.be.true;

    // Call collateral = (2*spot - strike) * qty
    const expectedCollateral = (E18('200000') - strike) * qty / E18('1');
    expect(o.collateral).to.equal(expectedCollateral);

    // BTC triples: raw profit far exceeds collateral
    await oracle.setPrice(300000);

    const before = await musd.balanceOf(buyer.address);
    await pool.connect(buyer).settle(id);
    const after = await musd.balanceOf(buyer.address);

    expect(after - before).to.equal(expectedCollateral);
    expect(await pool.lockedCollateral()).to.equal(0n);
  });

  it('splits remaining collateral back to a manual short on settle', async () => {
    const { pool, musd, oracle, seller, buyer } = await deploy();

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = E18('50');

    await pool.connect(seller).createShortOrder(1, strike, qty, exp, premium);
    const id   = (await pool.nextId()) - 1n;
    const coll = (await pool.getOption(id)).collateral;

    await pool.connect(buyer).fillLong(id);
    await oracle.setPrice(80000); // put ITM -> profit = (100k-80k)*0.01 = 200

    const sellerBefore = await musd.balanceOf(seller.address);
    const buyerBefore  = await musd.balanceOf(buyer.address);

    await pool.connect(buyer).settle(id);

    expect((await musd.balanceOf(buyer.address)) - buyerBefore).to.equal(E18('200'));
    expect((await musd.balanceOf(seller.address)) - sellerBefore).to.equal(coll - E18('200'));
  });
});

describe('Performance fee', () => {
  it('charges exactly the cumulative fee once, not on every event', async () => {
    const { pool, oracle, lp, buyer, owner } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike = E18('100000');
    const qty    = E18('0.01');
    const exp    = await expiry(86400); // 1 day: premium comfortably exceeds a small ITM payout
    const quote  = await pool.quotePremium(false, strike, qty, exp);
    const premium = quote + E18('1');

    // Two pool-filled puts: both premiums already count toward gross yield.
    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium);
    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium);
    const idA = (await pool.nextId()) - 2n;
    const idB = (await pool.nextId()) - 1n;

    await oracle.setPrice(99900); // small ITM: profit = 1, below the earned premium
    await pool.connect(buyer).settle(idA);
    expect(await pool.totalPremiumsEarned()).to.be.gt(await pool.totalSettlementsPaid());

    const netYield = (await pool.totalPremiumsEarned()) - (await pool.totalSettlementsPaid());
    const feeAfterSettle = await pool.totalPerformanceFeePaid();
    expect(feeAfterSettle).to.equal(netYield * 1500n / 10000n);

    // Refunding B creates no new yield, so no additional fee should be taken.
    await time.increaseTo(exp + 1);
    await pool.connect(buyer).refund(idB);

    expect(await pool.totalPerformanceFeePaid()).to.equal(feeAfterSettle);
  });

  it('does not charge a fee when net yield is negative', async () => {
    const { pool, oracle, lp, buyer, owner } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike = E18('100000');
    const qty    = E18('0.05');
    const exp    = await expiry(3600);
    const quote  = await pool.quotePremium(true, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(0, strike, qty, exp, quote + E18('1'));
    const id = (await pool.nextId()) - 1n;

    // Huge move: settlement payout exceeds all premiums earned.
    await oracle.setPrice(300000);
    await pool.connect(buyer).settle(id);

    expect(await pool.totalPremiumsEarned()).to.be.lt(await pool.totalSettlementsPaid());
    expect(await pool.totalPerformanceFeePaid()).to.equal(0n);
  });
});

describe('Oracle & pricing bounds', () => {
  it('rejects orders while the oracle price is stale', async () => {
    const { pool, oracle, buyer } = await deploy();
    await oracle.setStale();

    await expect(pool.spotPrice()).to.be.revertedWith('stale price');
    await expect(
      pool.connect(buyer).createLongOrder(0, E18('100000'), E18('0.01'), await expiry(3600), E18('100'))
    ).to.be.revertedWith('stale price');
  });

  it('returns zero premium for degenerate inputs', async () => {
    const { pool } = await deploy();
    expect(await pool.bsPrice(true, 0, E18('100000'), 86400)).to.equal(0n);
    expect(await pool.bsPrice(true, E18('100000'), 0, 86400)).to.equal(0n);
    expect(await pool.bsPrice(true, E18('100000'), E18('100000'), 0)).to.equal(0n);
  });

  it('prices a deep ITM put above an ATM put', async () => {
    const { pool } = await deploy();
    const atm = await pool.bsPrice(false, E18('100000'), E18('100000'), 86400);
    const itm = await pool.bsPrice(false, E18('100000'), E18('120000'), 86400);
    expect(itm).to.be.gt(atm);
  });
});

describe('Liquidity views', () => {
  it('reports available liquidity and zero utilisation after a deposit', async () => {
    const { pool, lp } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    expect(await pool.availableLiquidity()).to.equal(E18('1000'));
    expect(await pool.utilisation()).to.equal(0n);
  });
});

describe('Trove margin (draw at creation)', () => {
  const strike = E18('100000'), qty = E18('0.01');
  const SIG = '0xdeadbeef';

  async function trovePut(ctx, { margin = E18('1000'), sigDeadline } = {}) {
    const { pool, trove, seller } = ctx;
    // 1 BTC ($100k) vs $50k debt -> 2.0 ICR
    await trove.setTrove(seller.address, 1, E18('1'), E18('50000'));
    const exp = await expiry(3600);
    return pool.connect(seller).createShortOrderTrove(
      1, strike, qty, exp, E18('50'), margin, SIG, sigDeadline ?? exp
    );
  }

  it('draws the margin from the Trove at creation and stores no signature', async () => {
    const ctx = await deploy();
    const { pool, musd, borrowerOps, seller } = ctx;
    const before = await musd.balanceOf(await pool.getAddress());
    const sellerBefore = await musd.balanceOf(seller.address);

    await expect(trovePut(ctx)).to.emit(borrowerOps, 'TrovePulled')
      .withArgs(seller.address, E18('1000'), seller.address); // borrowed into the seller's wallet, then pulled

    const id = (await pool.nextId()) - 1n;
    const o = await pool.getOption(id);
    expect(o.marginType).to.equal(1n);              // MarginType.TROVE
    expect(o.collateral).to.equal(E18('1000'));
    expect(o).to.not.have.property('troveSig');
    expect((await musd.balanceOf(await pool.getAddress())) - before).to.equal(E18('1000'));
    expect(await musd.balanceOf(seller.address)).to.equal(sellerBefore); // net zero for the seller's wallet
  });

  it('settles from pool-held margin: long paid, remainder to the short; no Mezo call at settle', async () => {
    const ctx = await deploy();
    const { pool, musd, oracle, borrowerOps, seller, buyer } = ctx;
    await trovePut(ctx);
    const id = (await pool.nextId()) - 1n;
    await pool.connect(buyer).fillLong(id);
    await oracle.setPrice(90000); // put ITM: 10k * 0.01 = 100

    const buyerBefore = await musd.balanceOf(buyer.address);
    const sellerBefore = await musd.balanceOf(seller.address);
    await expect(pool.connect(buyer).settle(id)).to.not.emit(borrowerOps, 'TrovePulled');
    expect((await musd.balanceOf(buyer.address)) - buyerBefore).to.equal(E18('100'));
    expect((await musd.balanceOf(seller.address)) - sellerBefore).to.equal(E18('900'));
  });

  it('refunds the margin to the short after expiry', async () => {
    const ctx = await deploy();
    const { pool, musd, seller, buyer } = ctx;
    await trovePut(ctx);
    const id = (await pool.nextId()) - 1n;
    await pool.connect(buyer).fillLong(id);
    await time.increase(3601);
    const before = await musd.balanceOf(seller.address);
    await pool.refund(id);
    expect((await musd.balanceOf(seller.address)) - before).to.equal(E18('1000'));
  });

  it('returns the margin when the short cancels an unfilled order', async () => {
    const ctx = await deploy();
    const { pool, musd, seller } = ctx;
    await trovePut(ctx);
    const id = (await pool.nextId()) - 1n;
    const before = await musd.balanceOf(seller.address);
    await pool.connect(seller).cancelOrder(id);
    expect((await musd.balanceOf(seller.address)) - before).to.equal(E18('1000'));
  });

  it('rejects margin below the required collateral', async () => {
    const ctx = await deploy();
    await expect(trovePut(ctx, { margin: E18('999') })).to.be.revertedWith('margin below required');
  });

  it('rejects a draw that would push the Trove below 150% ICR', async () => {
    const ctx = await deploy();
    const { pool, trove, seller } = ctx;
    // $100k coll, $66k debt: drawing $1k -> 67k debt -> 149% < 150%
    await trove.setTrove(seller.address, 1, E18('1'), E18('66000'));
    const exp = await expiry(3600);
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, E18('50'), E18('1000'), SIG, exp)
    ).to.be.revertedWith('trove ICR too low after draw');
  });

  it('rejects when Mezo delivers less than the signed amount', async () => {
    const ctx = await deploy();
    await ctx.borrowerOps.setDeliverBps(5000);
    await expect(trovePut(ctx)).to.be.revertedWith('trove draw short');
  });

  it('rejects a missing Trove, an empty signature and an expired deadline', async () => {
    const { pool, seller } = await deploy();
    const exp = await expiry(3600);
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, E18('50'), E18('1000'), SIG, exp)
    ).to.be.revertedWith('no active trove');
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, E18('50'), E18('1000'), '0x', exp)
    ).to.be.revertedWith('invalid trove sig');
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, E18('50'), E18('1000'), SIG, 1)
    ).to.be.revertedWith('invalid trove sig');
  });
});

describe('Cancel', () => {
  it('returns collateral when a short cancels an unfilled order', async () => {
    const { pool, musd, seller } = await deploy();
    const before = await musd.balanceOf(seller.address);

    await pool.connect(seller).createShortOrder(1, E18('100000'), E18('0.01'), await expiry(3600), E18('50'));
    const id = (await pool.nextId()) - 1n;
    await pool.connect(seller).cancelOrder(id);

    expect(await musd.balanceOf(seller.address)).to.equal(before);
  });

  it('blocks cancelling someone else\'s order', async () => {
    const { pool, seller, other } = await deploy();
    await pool.connect(seller).createShortOrder(1, E18('100000'), E18('0.01'), await expiry(3600), E18('50'));
    const id = (await pool.nextId()) - 1n;
    await expect(pool.connect(other).cancelOrder(id)).to.be.revertedWith('not your order');
  });
});

describe('Total loss: deposits blocked until worthless shares are cleared', () => {
  async function harness() {
    const ctx = await deploy();
    const Pool = await ethers.getContractFactory('OptionPoolHarness');
    const pool = await Pool.deploy(
      await ctx.musd.getAddress(), await ctx.ymusd.getAddress(), await ctx.oracle.getAddress(),
      await ctx.trove.getAddress(), await ctx.borrowerOps.getAddress()
    );
    await ctx.ymusd.setPool(await pool.getAddress());
    for (const w of [ctx.lp, ctx.buyer, ctx.seller, ctx.other]) {
      await ctx.musd.mint(w.address, E18('100000'));
      await ctx.musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    await pool.connect(ctx.lp).deposit(E18('1000'));
    await pool.connect(ctx.buyer).deposit(E18('500'));
    await pool.forceTotalAssets(0); // simulate a total loss
    return { ...ctx, pool };
  }

  it('reverts a deposit while worthless yMUSD is outstanding', async () => {
    const { pool, other } = await harness();
    await expect(pool.connect(other).deposit(E18('100')))
      .to.be.revertedWith('pool insolvent: clear old shares first');
  });

  it('owner clears all worthless shares, then a new deposit mints 1:1', async () => {
    const { pool, ymusd, owner, lp, buyer, other } = await harness();
    await expect(pool.connect(owner).clearWorthlessShares([lp.address, buyer.address]))
      .to.emit(pool, 'SharesCleared').withArgs(2n, E18('1500'));
    expect(await ymusd.totalSupply()).to.equal(0n);
    await pool.connect(other).deposit(E18('100'));
    expect(await ymusd.balanceOf(other.address)).to.equal(E18('100'));
  });

  it('rejects an incomplete holder list', async () => {
    const { pool, owner, lp } = await harness();
    await expect(pool.connect(owner).clearWorthlessShares([lp.address]))
      .to.be.revertedWith('holders list incomplete');
  });

  it('cannot clear shares while the pool has assets, and only the owner can call it', async () => {
    const { pool, owner, lp, buyer } = await deploy().then(async ctx => {
      await ctx.pool.connect(ctx.lp).deposit(E18('1000'));
      return ctx;
    });
    await expect(pool.connect(owner).clearWorthlessShares([lp.address]))
      .to.be.revertedWith('pool has assets');
    await expect(pool.connect(buyer).clearWorthlessShares([lp.address]))
      .to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });

  it('holders can also exit worthless shares themselves by withdrawing', async () => {
    const { pool, ymusd, lp } = await harness();
    const bal = await ymusd.balanceOf(lp.address);
    await pool.connect(lp).withdraw(bal);
    expect(await ymusd.balanceOf(lp.address)).to.equal(0n);
  });
});
