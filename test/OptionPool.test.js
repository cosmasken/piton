const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { time }        = require('@nomicfoundation/hardhat-network-helpers');

const E18  = ethers.parseEther;
const BTC_PRICE = 100_000; // $100k

async function deploy() {
  const [owner, lp, buyer, seller] = await ethers.getSigners();

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

  // Fund wallets
  for (const w of [lp, buyer, seller]) {
    await musd.mint(w.address, E18('100000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }

  return { pool, musd, ymusd, oracle, trove, borrowerOps, owner, lp, buyer, seller };
}

async function expiry(seconds) {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp + seconds;
}

// ─── Pool deposit / withdraw ──────────────────────────────────────────────────

describe('Pool: deposit & withdraw', () => {
  it('mints yMUSD on deposit', async () => {
    const { pool, ymusd, lp } = await deploy();
    await pool.connect(lp).deposit(E18('1000'));
    expect(await ymusd.balanceOf(lp.address)).to.equal(E18('1000'));
    expect(await pool.totalAssets()).to.equal(E18('1000'));
  });

  it('burns yMUSD on withdraw', async () => {
    const { pool, musd, ymusd, lp } = await deploy();
    const before = await musd.balanceOf(lp.address);
    await pool.connect(lp).deposit(E18('1000'));
    await pool.connect(lp).withdraw(E18('1000'));
    expect(await ymusd.balanceOf(lp.address)).to.equal(0n);
    expect(await musd.balanceOf(lp.address)).to.equal(before);
  });

  it('blocks withdraw beyond available liquidity', async () => {
    const { pool, ymusd, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));
    // place a long order that pool fills, locking collateral
    const strike = E18('100000');
    const qty    = E18('0.01');
    const exp    = await expiry(3600);
    const premium = await pool.quotePremium(false, strike, qty, exp);
    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium + E18('1'));
    // pool should have locked collateral — withdraw all should fail
    await expect(pool.connect(lp).withdraw(await ymusd.balanceOf(lp.address)))
      .to.be.revertedWith('insufficient liquidity');
  });
});

// ─── BS pricing ──────────────────────────────────────────────────────────────

describe('BS pricing', () => {
  it('returns non-zero call premium', async () => {
    const { pool } = await deploy();
    const p = await pool.bsPrice(true, E18('100000'), E18('100000'), 86400);
    expect(p).to.be.gt(0n);
  });

  it('returns non-zero put premium', async () => {
    const { pool } = await deploy();
    const p = await pool.bsPrice(false, E18('100000'), E18('100000'), 86400);
    expect(p).to.be.gt(0n);
  });

  it('deep ITM call > ATM call', async () => {
    const { pool } = await deploy();
    const atm  = await pool.bsPrice(true, E18('100000'), E18('100000'), 86400);
    const itm  = await pool.bsPrice(true, E18('100000'), E18('80000'),  86400);
    expect(itm).to.be.gt(atm);
  });
});

// ─── Long order — pool auto-fill ─────────────────────────────────────────────

describe('Long order: pool auto-fill', () => {
  it('fills a put order atomically when pool has capital', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = await pool.quotePremium(false, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium + E18('1'));
    const id = (await pool.nextId()) - 1n;
    const o  = await pool.getOption(id);

    expect(o.status).to.equal(1n); // FILLED
    expect(o.filledByPool).to.be.true;
    expect(o.short).to.equal(await pool.getAddress());
  });

  it('leaves order open if pool has no capital', async () => {
    const { pool, buyer } = await deploy();
    // no deposit
    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = E18('100');

    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium);
    const id = (await pool.nextId()) - 1n;
    const o  = await pool.getOption(id);
    expect(o.status).to.equal(0n); // OPEN
  });

  it('leaves order open if premium below BS fair value', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike = E18('100000');
    const qty    = E18('0.01');
    const exp    = await expiry(3600);
    // send 1 wei as premium — way below fair value
    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, 1n);
    const id = (await pool.nextId()) - 1n;
    const o  = await pool.getOption(id);
    expect(o.status).to.equal(0n); // OPEN, not filled
  });
});

// ─── Settlement ───────────────────────────────────────────────────────────────

describe('Settlement', () => {
  it('pays profit to long on ITM put', async () => {
    const { pool, musd, oracle, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = await pool.quotePremium(false, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium + E18('1'));
    const id = (await pool.nextId()) - 1n;

    // BTC drops to $80k — put is ITM
    await oracle.setPrice(80000);

    const before = await musd.balanceOf(buyer.address);
    await pool.connect(buyer).settle(id);
    const after  = await musd.balanceOf(buyer.address);

    // profit = (100k - 80k) * 0.01 = $200
    expect(after - before).to.be.closeTo(E18('200'), E18('1'));
  });

  it('pays profit to long on ITM call', async () => {
    const { pool, musd, oracle, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = await pool.quotePremium(true, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(0, strike, qty, exp, premium + E18('1'));
    const id = (await pool.nextId()) - 1n;

    // BTC pumps to $120k — call is ITM
    await oracle.setPrice(120000);

    const before = await musd.balanceOf(buyer.address);
    await pool.connect(buyer).settle(id);
    const after  = await musd.balanceOf(buyer.address);

    // profit = (120k - 100k) * 0.01 = $200
    expect(after - before).to.be.closeTo(E18('200'), E18('1'));
  });

  it('reverts settle on OTM option', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(3600);
    const premium = await pool.quotePremium(false, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium + E18('1'));
    const id = (await pool.nextId()) - 1n;
    // BTC stays at $100k — put is OTM
    await expect(pool.connect(buyer).settle(id)).to.be.revertedWith('not in the money');
  });
});

// ─── Refund ───────────────────────────────────────────────────────────────────

describe('Refund', () => {
  it('releases locked collateral back to pool after expiry', async () => {
    const { pool, lp, buyer } = await deploy();
    await pool.connect(lp).deposit(E18('10000'));

    const strike  = E18('100000');
    const qty     = E18('0.01');
    const exp     = await expiry(1800); // 30 min
    const premium = await pool.quotePremium(false, strike, qty, exp);

    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, premium + E18('1'));
    const id = (await pool.nextId()) - 1n;

    const lockedBefore = await pool.lockedCollateral();
    await time.increaseTo(exp + 1);
    await pool.connect(buyer).refund(id);

    expect(await pool.lockedCollateral()).to.be.lt(lockedBefore);
  });
});

// ─── Manual short order ───────────────────────────────────────────────────────

describe('Manual short order', () => {
  it('seller posts collateral, buyer fills, seller gets premium', async () => {
    const { pool, musd, seller, buyer } = await deploy();

    const strike    = E18('100000');
    const qty       = E18('0.01');
    const exp       = await expiry(3600);
    const premium   = E18('50');

    const sellerBefore = await musd.balanceOf(seller.address);
    await pool.connect(seller).createShortOrder(1, strike, qty, exp, premium);
    const id = (await pool.nextId()) - 1n;

    await pool.connect(buyer).fillLong(id);

    // seller receives premium minus 2% fee
    const sellerAfter = await musd.balanceOf(seller.address);
    const net = premium * 98n / 100n;
    // seller paid collateral upfront, got premium back — net change is premium - collateral
    const o = await pool.getOption(id);
    expect(sellerBefore - sellerAfter).to.equal(o.collateral - net);
  });
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

describe('Cancel', () => {
  it('returns premium to buyer on unfilled long order', async () => {
    const { pool, musd, buyer } = await deploy();
    const premium = E18('10');
    const before  = await musd.balanceOf(buyer.address);

    await pool.connect(buyer).createLongOrder(0, E18('100000'), E18('0.01'), expiry(3600), premium);
    const id = (await pool.nextId()) - 1n;
    await pool.connect(buyer).cancelOrder(id);

    expect(await musd.balanceOf(buyer.address)).to.equal(before);
  });
});

// ─── Owner controls ───────────────────────────────────────────────────────────

describe('Owner controls', () => {
  it('setIV rejects out-of-range values', async () => {
    const { pool } = await deploy();
    await expect(pool.setIV(E18('2'))).to.be.revertedWith('iv out of range');
    await expect(pool.setIV(E18('0.4'))).to.be.revertedWith('iv out of range');
  });

  it('paused pool rejects deposits', async () => {
    const { pool, lp } = await deploy();
    await pool.pausePool();
    await expect(pool.connect(lp).deposit(E18('100'))).to.be.revertedWith('paused');
  });

  it('setProtocolFeeBps rejects > 5%', async () => {
    const { pool } = await deploy();
    await expect(pool.setProtocolFeeBps(600)).to.be.revertedWith('max 5%');
  });
});
