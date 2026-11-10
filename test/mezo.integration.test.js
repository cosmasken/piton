// Integration tests: OptionPool against Mezo's real MUSD protocol contracts (mezo-org/musd),
// deployed on the in-process Hardhat network exactly as Mezo's own deploy scripts wire them.
//
// Requires the Mezo sources: run `./tools/fetch-mezo.sh` (or `npm run fetch:mezo`) first.
// Skipped automatically when contracts/mezo is missing.

const fs   = require('fs');
const path = require('path');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const HAS_MEZO = fs.existsSync(path.join(__dirname, '../contracts/mezo/BorrowerOperations.sol'));
const E18 = ethers.parseEther;
const ZERO = ethers.ZeroAddress;
const MAX_BYTES_32 = ethers.MaxUint256;
const BTC = 100_000n;

// Deploy an upgradeable Mezo contract behind an ERC1967 proxy and run its initializer.
async function proxy(name, initArgs = []) {
  const Impl  = await ethers.getContractFactory(name);
  const impl  = await Impl.deploy();
  const data  = Impl.interface.encodeFunctionData('initialize', initArgs);
  const Proxy = await ethers.getContractFactory('ERC1967Proxy');
  const p     = await Proxy.deploy(await impl.getAddress(), data);
  return Impl.attach(await p.getAddress());
}

async function deployMezo() {
  const [deployer, lp, buyer, seller, whale, attacker] = await ethers.getSigners();

  const activePool          = await proxy('ActivePool');
  const borrowerOperations  = await proxy('BorrowerOperations');
  const bos                 = await proxy('BorrowerOperationsSignatures');
  const collSurplusPool     = await proxy('CollSurplusPool');
  const defaultPool         = await proxy('DefaultPool');
  const gasPool             = await proxy('GasPool');
  const governableVariables = await proxy('GovernableVariables', [7200]);
  const hintHelpers         = await proxy('HintHelpers');
  const interestRateManager = await proxy('InterestRateManager');
  const pcv                 = await proxy('PCV', [7200]);
  const priceFeed           = await proxy('PriceFeed');
  const sortedTroves        = await proxy('SortedTroves');
  const stabilityPool       = await proxy('StabilityPool');
  const troveManager        = await proxy('TroveManager');

  const aggregator = await (await ethers.getContractFactory('MockAggregator')).deploy(18);
  await aggregator.setPrice(BTC * 10n ** 18n);

  const musd = await (await ethers.getContractFactory('MUSDTester')).deploy();
  const A = c => c.getAddress();

  await musd.initialize(await A(troveManager), await A(stabilityPool), await A(borrowerOperations), await A(interestRateManager));
  await priceFeed.setOracle(await A(aggregator));
  await bos.setAddresses(await A(activePool), await A(borrowerOperations), await A(collSurplusPool),
    await A(defaultPool), await A(interestRateManager), await A(stabilityPool));
  await interestRateManager.setAddresses(await A(activePool), await A(borrowerOperations), await A(musd),
    await A(pcv), await A(troveManager));
  await stabilityPool.setAddresses(await A(activePool), await A(borrowerOperations), await A(musd),
    await A(priceFeed), await A(sortedTroves), await A(troveManager));
  await hintHelpers.setAddresses(await A(borrowerOperations), await A(sortedTroves), await A(troveManager));
  await pcv.setAddresses(await A(borrowerOperations), await A(musd));
  await defaultPool.setAddresses(await A(activePool), await A(troveManager));
  await activePool.setAddresses(await A(borrowerOperations), await A(collSurplusPool), await A(defaultPool),
    await A(interestRateManager), await A(stabilityPool), await A(troveManager));
  await borrowerOperations.setAddresses([
    await A(activePool), await A(bos), await A(collSurplusPool), await A(defaultPool), await A(gasPool),
    await A(governableVariables), await A(interestRateManager), await A(musd), await A(pcv),
    await A(priceFeed), await A(sortedTroves), await A(stabilityPool), await A(troveManager),
  ]);
  await collSurplusPool.setAddresses(await A(activePool), await A(borrowerOperations), await A(troveManager));
  await troveManager.setAddresses(await A(activePool), await A(borrowerOperations), await A(collSurplusPool),
    await A(defaultPool), await A(gasPool), await A(interestRateManager), await A(musd), await A(pcv),
    await A(priceFeed), await A(sortedTroves), await A(stabilityPool));
  await gasPool.setAddresses(await A(musd), await A(troveManager));
  await sortedTroves.setParams(MAX_BYTES_32, await A(borrowerOperations), await A(troveManager));

  // Piton, wired to the real Mezo contracts. The Skip oracle and Mezo's PriceFeed both read the
  // same Chainlink-style aggregator, so Piton and Mezo see one BTC price.
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool  = await (await ethers.getContractFactory('OptionPool')).deploy(
    await A(musd), await A(ymusd), await A(aggregator), await A(troveManager), await A(bos)
  );
  await ymusd.setPool(await A(pool));
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900); // exit protections have their own tests

  // Whale Trove keeps the system out of Recovery Mode (TCR >= 150%).
  await openTrove({ borrowerOperations }, whale, E18('100000'), 5n);
  // Fund LP / buyer with real MUSD (test-only mint on MUSDTester).
  for (const w of [lp, buyer, seller]) {
    await musd.unprotectedMint(w.address, E18('100000'));
    await musd.connect(w).approve(await A(pool), ethers.MaxUint256);
  }

  return { deployer, lp, buyer, seller, whale, attacker, musd, pool, ymusd, aggregator, priceFeed,
           troveManager, borrowerOperations, bos };
}

/** Open a Trove borrowing `debt` MUSD at roughly `icr`x collateralisation. */
async function openTrove({ borrowerOperations }, who, debt, icr) {
  const collWei = (debt * icr) / BTC; // debt[1e18 USD] * icr / price[USD/BTC] -> BTC wei
  await borrowerOperations.connect(who).openTrove(debt, ZERO, ZERO, { value: collWei });
}

async function signWithdrawMUSD(ctx, who, amount, recipient, deadline) {
  const { bos } = ctx;
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: 'BorrowerOperationsSignatures', version: '1', chainId, verifyingContract: await bos.getAddress() };
  const types = { WithdrawMUSD: [
    { name: 'amount', type: 'uint256' }, { name: 'borrower', type: 'address' },
    { name: 'recipient', type: 'address' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ]};
  const nonce = await bos.getNonce(who.address);
  return who.signTypedData(domain, types, { amount, borrower: who.address, recipient, nonce, deadline });
}

async function now() { return (await ethers.provider.getBlock('latest')).timestamp; }

(HAS_MEZO ? describe : describe.skip)('Mezo integration (real MUSD protocol on Hardhat)', function () {
  this.timeout(120_000);

  // Seller has a 1 BTC Trove with ~$50k debt (ICR ~200%).
  async function fixture() {
    const ctx = await deployMezo();
    await openTrove(ctx, ctx.seller, E18('50000'), 2n);
    return ctx;
  }

  const strike = E18('100000'), qty = E18('0.01'), premium = E18('50'), margin = E18('1000');

  async function createTroveShort(ctx, overrides = {}) {
    const { pool, seller } = ctx;
    const exp      = (await now()) + 3600;
    const deadline = (await now()) + 600;
    const amount   = overrides.margin ?? margin;
    const sig      = overrides.sig ?? await signWithdrawMUSD(ctx, seller, amount, seller.address, deadline);
    const tx = pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, premium, amount, sig, deadline);
    return { tx, sig, deadline, exp };
  }

  it('wires up: Mezo PriceFeed and Piton agree on the BTC price; seller Trove is active', async () => {
    const { priceFeed, pool, troveManager, seller } = await loadFixture(fixture);
    expect(await priceFeed.fetchPrice()).to.equal(E18('100000'));
    expect(await pool.spotPrice()).to.equal(E18('100000'));
    expect(await troveManager.getTroveStatus(seller.address)).to.equal(1n);
  });

  it('Trove margin: borrows exactly the margin from the real Trove (+0.1% fee to debt) into the pool', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, musd, troveManager, borrowerOperations, seller } = ctx;
    const debtBefore = await troveManager.getTroveDebt(seller.address);
    const poolBefore = await musd.balanceOf(await pool.getAddress());
    const walletBefore = await musd.balanceOf(seller.address);

    const { tx } = await createTroveShort(ctx);
    await (await tx).wait();

    const id = (await pool.nextId()) - 1n;
    const o  = await pool.getOption(id);
    expect(o.marginType).to.equal(1n);
    expect(o.collateral).to.equal(margin);
    expect((await musd.balanceOf(await pool.getAddress())) - poolBefore).to.equal(margin);
    expect(await musd.balanceOf(seller.address)).to.equal(walletBefore);

    const rate = await borrowerOperations.borrowingRate(); // 0.1%
    const debtAfter = await troveManager.getTroveDebt(seller.address);
    // + margin + borrowing fee (interest accrued over a couple of blocks is negligible)
    expect(debtAfter - debtBefore).to.be.closeTo(margin + margin * rate / E18('1'), E18('0.01'));
  });

  it('Trove margin: full lifecycle — buyer fills, BTC drops, long settles, short keeps the rest', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, musd, aggregator, seller, buyer } = ctx;
    await (await (await createTroveShort(ctx)).tx).wait();
    const id = (await pool.nextId()) - 1n;

    const sellerBefore = await musd.balanceOf(seller.address);
    await pool.connect(buyer).fillLong(id);
    expect((await musd.balanceOf(seller.address)) - sellerBefore).to.equal(premium * 98n / 100n);

    await aggregator.setPrice(E18('90000')); // put ITM: (100k-90k) * 0.01 = 100 MUSD
    const buyerBefore = await musd.balanceOf(buyer.address);
    const sellerMid   = await musd.balanceOf(seller.address);
    await pool.connect(buyer).settle(id);
    expect((await musd.balanceOf(buyer.address)) - buyerBefore).to.equal(E18('100'));
    expect((await musd.balanceOf(seller.address)) - sellerMid).to.equal(E18('900'));
  });

  it('Trove margin: refund after expiry returns margin; seller can repay the Trove with it', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, musd, troveManager, borrowerOperations, seller, buyer } = ctx;
    await (await (await createTroveShort(ctx)).tx).wait();
    const id = (await pool.nextId()) - 1n;
    await pool.connect(buyer).fillLong(id);
    await time.increase(3601);

    const before = await musd.balanceOf(seller.address);
    await pool.refund(id);
    expect((await musd.balanceOf(seller.address)) - before).to.equal(margin);

    const debtBefore = await troveManager.getTroveDebt(seller.address);
    await borrowerOperations.connect(seller).repayMUSD(margin, ZERO, ZERO);
    expect(debtBefore - (await troveManager.getTroveDebt(seller.address))).to.be.closeTo(margin, E18('0.01'));
  });

  it('signature cannot be replayed: Mezo nonce is consumed on first use', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, bos, seller } = ctx;
    const { tx, sig, deadline, exp } = await createTroveShort(ctx);
    await (await tx).wait();
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, premium, margin, sig, deadline)
    ).to.be.revertedWith('BorrowerOperationsSignatures: Invalid signature');
    await expect(
      bos.withdrawMUSDWithSignature(margin, ZERO, ZERO, seller.address, seller.address, sig, deadline)
    ).to.be.revertedWith('BorrowerOperationsSignatures: Invalid signature');
  });

  it('front-run is harmless: attacker submitting the sig sends the MUSD to the seller, not the pool', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, bos, musd, seller, attacker } = ctx;
    const deadline = (await now()) + 600;
    const sig = await signWithdrawMUSD(ctx, seller, margin, seller.address, deadline);

    const poolBefore = await musd.balanceOf(await pool.getAddress());
    const sellerBefore = await musd.balanceOf(seller.address);
    // attacker copies the signature from the mempool and submits it first
    await bos.connect(attacker).withdrawMUSDWithSignature(margin, ZERO, ZERO, seller.address, seller.address, sig, deadline);
    expect((await musd.balanceOf(seller.address)) - sellerBefore).to.equal(margin);
    expect(await musd.balanceOf(await pool.getAddress())).to.equal(poolBefore);

    // seller's own order then fails cleanly; nothing is stranded in the pool
    const exp = (await now()) + 3600;
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, premium, margin, sig, deadline)
    ).to.be.revertedWith('BorrowerOperationsSignatures: Invalid signature');
  });

  it('a signature that sends MUSD anywhere but the seller is rejected by Mezo', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, seller } = ctx;
    const deadline = (await now()) + 600;
    const sigToPool = await signWithdrawMUSD(ctx, seller, margin, await pool.getAddress(), deadline);
    await expect((await createTroveShort(ctx, { sig: sigToPool })).tx)
      .to.be.revertedWith('BorrowerOperationsSignatures: Invalid signature');
  });

  it('rejects a draw that would take the real Trove below Piton\'s 150% floor', async () => {
    const ctx = await loadFixture(fixture);
    // seller: ~$100k coll vs ~$50.2k debt. A $16k draw -> ~66.2k debt -> ~151%; $20k -> ~142%
    const big = E18('20000');
    await ctx.pool.setMaxOptionCollateral(E18('50000'));
    await expect((await createTroveShort(ctx, { margin: big })).tx).to.be.revertedWith('trove ICR too low after draw');
  });

  it('rejects a signature for a different amount than the margin', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, seller } = ctx;
    const deadline = (await now()) + 600;
    const sig = await signWithdrawMUSD(ctx, seller, E18('999'), seller.address, deadline);
    const exp = (await now()) + 3600;
    await expect(
      pool.connect(seller).createShortOrderTrove(1, strike, qty, exp, premium, margin, sig, deadline)
    ).to.be.revertedWith('BorrowerOperationsSignatures: Invalid signature');
  });

  it('pool path with real MUSD: LP deposit, auto-fill, settle, withdraw', async () => {
    const ctx = await loadFixture(fixture);
    const { pool, ymusd, musd, aggregator, lp, buyer } = ctx;
    await pool.connect(lp).deposit(E18('10000'));
    const exp = (await now()) + 3600;
    const q = await pool.quotePremium(false, strike, qty, exp);
    await pool.connect(buyer).createLongOrder(1, strike, qty, exp, q * 105n / 100n);
    const id = (await pool.nextId()) - 1n;
    expect((await pool.getOption(id)).filledByPool).to.equal(true);

    await aggregator.setPrice(E18('95000'));
    const before = await musd.balanceOf(buyer.address);
    await pool.connect(buyer).settle(id);
    expect((await musd.balanceOf(buyer.address)) - before).to.equal(E18('50'));

    const shares = await ymusd.balanceOf(lp.address);
    await pool.connect(lp).withdraw(shares);
    expect(await ymusd.balanceOf(lp.address)).to.equal(0n);
  });

  it('Protect-my-Trove maths match Mezo: liquidation happens at debt * 110% / coll', async () => {
    const ctx = await loadFixture(fixture);
    const { troveManager, seller } = ctx;
    const coll = await troveManager.getTroveColl(seller.address);
    const debt = await troveManager.getTroveDebt(seller.address);
    const liqPrice = debt * E18('1.1') / coll; // 1e18-scaled USD per BTC
    expect(await troveManager.MCR()).to.equal(E18('1.1'));
    // ICR at the computed liquidation price is exactly MCR (within rounding)
    expect(await troveManager.getCurrentICR(seller.address, liqPrice)).to.be.closeTo(E18('1.1'), 10n ** 9n);
  });
});
