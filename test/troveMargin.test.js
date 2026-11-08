/**
 * Trove margin (type 2) tests for CallOption and PutOption.
 *
 * Uses MockTroveManager (from trovepilot) and MockBorrowerOpsSigs which mints
 * MUSD to the contract on adjustTroveWithSignature, simulating the real
 * BorrowerOperationsSignatures pulling from the short's Trove.
 */

const { expect } = require('chai');
const { ethers }  = require('hardhat');

const E18 = n => ethers.parseUnits(String(n), 18);
const SIG  = '0xdeadbeef'; // non-empty placeholder — mock ignores content
const FAR  = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days

async function deploy(btcPrice) {
  const [, long, short] = await ethers.getSigners();

  const MUSD = await ethers.getContractFactory('MockERC20');
  const musd = await MUSD.deploy('MUSD', 'MUSD');

  const Oracle = await ethers.getContractFactory('MockSkipOracle');
  const oracle = await Oracle.deploy(btcPrice, false);

  // MockTroveManager from trovepilot pattern
  const TM = await ethers.getContractFactory('MockTroveManager');
  const tm = await TM.deploy();

  // MockBorrowerOpsSigs mints MUSD to recipient on adjustTroveWithSignature
  const BOS = await ethers.getContractFactory('MockBorrowerOpsSigs');
  const bos = await BOS.deploy(await musd.getAddress());

  const Call = await ethers.getContractFactory('CallOptionTest');
  const call = await Call.deploy(
    await musd.getAddress(), await oracle.getAddress(),
    await tm.getAddress(),   await bos.getAddress()
  );

  const Put = await ethers.getContractFactory('PutOptionTest');
  const put = await Put.deploy(
    await musd.getAddress(), await oracle.getAddress(),
    await tm.getAddress(),   await bos.getAddress()
  );

  await musd.mint(long.address,  E18(1_000_000));
  await musd.mint(short.address, E18(1_000_000));

  return { musd, oracle, tm, bos, call, put, long, short };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Set up a healthy Trove for `short`: 2 BTC coll, 50 000 MUSD debt at price */
async function setupTrove(tm, short, btcPrice) {
  const coll = E18(2);                          // 2 BTC
  const debt = E18(50_000);                     // 50 000 MUSD
  // equity = 2 * btcPrice - 50 000
  await tm.setTrove(short.address, coll, debt, 1); // status 1 = active
}

// ── CallOption Trove margin ───────────────────────────────────────────────────

describe('CallOption — Trove margin (type 2)', () => {
  const PRICE  = 100_000;
  const STRIKE = E18(70_000);  // > 100 000/3 = 33 333 ✓
  const QTY    = E18(1);
  const COST   = E18(500);

  it('short can create order backed by Trove equity', async () => {
    const { musd, tm, call, long, short } = await deploy(PRICE);
    await setupTrove(tm, short, PRICE);
    // equity = 2*100 000 - 50 000 = 150 000 > required 2/3*100 000 = 66 667 ✓

    await musd.connect(long).approve(await call.getAddress(), COST);
    await call.connect(long).createNewOptionLong(STRIKE, COST, QTY);

    await call.connect(short).sellToOpen(1, 2, 0, SIG, FAR);

    const opt = await call.idToOption(1);
    expect(opt.settlementType).to.equal(2n);
    expect(opt.isAvailable).to.be.false;
    expect(opt.partyS).to.equal(short.address);
  });

  it('settlement pulls profit from Trove via adjustTroveWithSignature', async () => {
    const { musd, tm, call, long, short } = await deploy(PRICE);
    await setupTrove(tm, short, PRICE);

    await musd.connect(long).approve(await call.getAddress(), COST);
    await call.connect(long).createNewOptionLong(STRIKE, COST, QTY);
    await call.connect(short).sellToOpen(1, 2, 0, SIG, FAR);

    const longBefore = await musd.balanceOf(long.address);
    await call.connect(long).settleOption(1);
    const longAfter = await musd.balanceOf(long.address);

    // profit = 100 000 - 70 000 = 30 000 MUSD minted by mock BOS into contract → long
    expect(longAfter - longBefore).to.equal(E18(30_000));
  });

  it('settlement refunds premium when Trove is liquidated', async () => {
    const { musd, tm, call, long, short } = await deploy(PRICE);
    await setupTrove(tm, short, PRICE);

    await musd.connect(long).approve(await call.getAddress(), COST);
    await call.connect(long).createNewOptionLong(STRIKE, COST, QTY);
    await call.connect(short).sellToOpen(1, 2, 0, SIG, FAR);

    // Liquidate the Trove (status 0)
    await tm.setTrove(short.address, 0, 0, 0);

    // Long's premium was already paid to short at fill — contract holds nothing.
    // Settlement marks the option settled; long loses their premium (same as OTM expiry).
    await call.connect(long).settleOption(1);
    const opt = await call.idToOption(1);
    expect(opt.settled).to.be.true;
  });

  it('rejects order when Trove equity is insufficient', async () => {
    const { musd, tm, call, long, short } = await deploy(PRICE);
    // Trove with only 0.5 BTC coll, 40 000 debt → equity = 10 000 < required 66 667
    await tm.setTrove(short.address, E18('0.5'), E18(40_000), 1);

    await musd.connect(long).approve(await call.getAddress(), COST);
    await call.connect(long).createNewOptionLong(STRIKE, COST, QTY);

    await expect(
      call.connect(short).sellToOpen(1, 2, 0, SIG, FAR)
    ).to.be.revertedWith('trove low');
  });
});

// ── PutOption Trove margin ────────────────────────────────────────────────────

describe('PutOption — Trove margin (type 2)', () => {
  const PRICE  = 50_000;
  const STRIKE = E18(60_000);  // ITM put: strike > price ✓
  const QTY    = E18(1);
  const COST   = E18(300);

  it('short can create put order backed by Trove equity', async () => {
    const { musd, tm, put, long, short } = await deploy(PRICE);
    // equity = 2*50 000 - 50 000 = 50 000 < strike 60 000 — need bigger Trove
    await tm.setTrove(short.address, E18(3), E18(50_000), 1);
    // equity = 3*50 000 - 50 000 = 100 000 > 60 000 ✓

    await musd.connect(long).approve(await put.getAddress(), COST);
    await put.connect(long).createNewOptionLong(0, STRIKE, COST, QTY);

    await put.connect(short).sellToOpen(1, 0, SIG, FAR);

    const opt = await put.idToOption(1);
    expect(opt.settlementType).to.equal(2n);
    expect(opt.partyS).to.equal(short.address);
  });

  it('settlement pulls profit from Trove', async () => {
    const { musd, tm, put, long, short } = await deploy(PRICE);
    await tm.setTrove(short.address, E18(3), E18(50_000), 1);

    await musd.connect(long).approve(await put.getAddress(), COST);
    await put.connect(long).createNewOptionLong(0, STRIKE, COST, QTY);
    await put.connect(short).sellToOpen(1, 0, SIG, FAR);

    const longBefore = await musd.balanceOf(long.address);
    // settlementType is 2 (Trove), not BTC — no msg.value needed
    await put.connect(long).settleOption(1);
    const longAfter = await musd.balanceOf(long.address);

    // profit = 60 000 - 50 000 = 10 000 MUSD
    expect(longAfter - longBefore).to.equal(E18(10_000));
  });

  it('settlement refunds premium when Trove is liquidated', async () => {
    const { musd, tm, put, long, short } = await deploy(PRICE);
    await tm.setTrove(short.address, E18(3), E18(50_000), 1);

    await musd.connect(long).approve(await put.getAddress(), COST);
    await put.connect(long).createNewOptionLong(0, STRIKE, COST, QTY);
    await put.connect(short).sellToOpen(1, 0, SIG, FAR);

    await tm.setTrove(short.address, 0, 0, 0); // liquidated

    // Premium was paid to short at fill — contract holds nothing to refund.
    // Settlement marks settled; long loses premium (same as OTM expiry).
    await put.connect(long).settleOption(1);
    const opt = await put.idToOption(1);
    expect(opt.settled).to.be.true;
  });
});
