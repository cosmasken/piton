// Idle pool MUSD in Mezo's MUSD Savings Rate (sMUSD): only free capital is invested, within a cap; locked
// collateral always stays as MUSD in the pool, so exercise, refunds and sell-back never depend on the vault.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { poolFactory } = require('./helpers/poolFactory');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, lp, buyer, keeper, guardian, lp2] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await poolFactory()).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); await pool.setMinPoolExpiry(900); await pool.setBreaker(600, 50000, 0);
  await pool.setIvKeeper(keeper.address); await pool.setGuardian(guardian.address);
  const savings = await (await ethers.getContractFactory('MockSavings')).deploy(await musd.getAddress());
  for (const w of [lp, buyer, lp2]) { await musd.mint(w.address, E18('1000000')); await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256); }
  await pool.connect(lp).deposit(E18('10000'));
  return { pool, musd, ymusd, oracle, savings, owner, lp, buyer, keeper, guardian, lp2 };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
const poolAddr = p => p.getAddress();
// MUSD the pool holds itself (excludes what is in savings)
const cash = async (musd, pool) => musd.balanceOf(await poolAddr(pool));

async function buyPut(pool, buyer, strike = '100000', qty = '0.01', days = 1) {
  const exp = (await now()) + days * 86400;
  const q = await pool.quotePremium(false, E18(strike), E18(qty), exp);
  await pool.connect(buyer).createLongOrder(1, E18(strike), E18(qty), exp, q);
  const id = (await pool.nextId()) - 1n;
  expect((await pool.getOption(id)).filledByPool).to.equal(true);
  return id;
}

describe('Savings: idle pool MUSD in sMUSD', () => {
  it('only the owner configures it; cap at most 80%; the vault cannot change while money is in it', async () => {
    const { pool, savings, lp, keeper } = await deploy();
    await expect(pool.connect(lp).setSavings(await savings.getAddress(), 5000)).to.be.reverted;
    await expect(pool.setSavings(await savings.getAddress(), 8001)).to.be.revertedWith('bad savings');
    await pool.setSavings(await savings.getAddress(), 5000);
    await pool.connect(keeper).invest(E18('1000'));
    await expect(pool.setSavings(ethers.ZeroAddress, 5000)).to.be.revertedWith('bad savings');
    await pool.setSavings(await savings.getAddress(), 2000);   // same vault, new cap: allowed
    expect(await pool.investCapBps()).to.equal(2000n);
  });

  it('owner or keeper can invest, only free capital within the cap, and the share price does not move', async () => {
    const { pool, musd, ymusd, savings, lp, buyer, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 5000);
    await buyPut(pool, buyer);                                  // locks 1,000 MUSD
    const locked = await pool.lockedCollateral();
    const free = (await pool.totalAssets()) - locked;
    const assetsBefore = await pool.totalAssets();
    const navBefore = await pool.netAssetValue();
    await expect(pool.connect(lp).invest(E18('1'))).to.be.revertedWith('not keeper');
    await expect(pool.connect(keeper).invest(free / 2n + 1n)).to.be.revertedWith('over cap');
    await pool.connect(keeper).invest(free / 2n);
    expect(await pool.invested()).to.equal(free / 2n);
    expect(await savings.balanceOf(await poolAddr(pool))).to.equal(free / 2n);
    expect(await pool.totalAssets()).to.equal(assetsBefore);     // moved, not spent
    // NAV only drifts up by the premium released over the extra blocks, never down
    const nav = await pool.netAssetValue();
    expect(nav).to.be.gte(navBefore); expect(nav - navBefore).to.be.lt(E18('0.01'));
    expect(await cash(musd, pool)).to.be.gte(locked);            // collateral still held as MUSD
    expect(await ymusd.totalSupply()).to.equal(E18('10000'));
  });

  it('an LP withdrawal larger than the cash on hand recalls MUSD from savings and pays in full', async () => {
    const { pool, musd, ymusd, savings, lp, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 8000);
    await pool.connect(keeper).invest(E18('8000'));             // 2,000 MUSD left as cash
    const before = await musd.balanceOf(lp.address);
    await pool.connect(lp).withdraw(await ymusd.balanceOf(lp.address));
    expect((await musd.balanceOf(lp.address)) - before).to.equal(E18('10000'));
    expect(await pool.invested()).to.equal(0n);
    expect(await pool.totalAssets()).to.equal(0n);
  });

  it('a pool sale recalls cash when needed, so locked collateral is always held as MUSD', async () => {
    const { pool, musd, savings, buyer, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 8000);
    await pool.connect(keeper).invest(E18('8000'));             // 2,000 MUSD cash
    await buyPut(pool, buyer, '100000', '0.024');               // needs 2,400 MUSD collateral
    expect(await pool.lockedCollateral()).to.equal(E18('2400'));
    expect(await cash(musd, pool)).to.be.gte(E18('2400'));
    expect(await pool.invested()).to.be.lt(E18('8000'));
  });

  it('yield is booked into the pool and counted for existing LPs before a new deposit is priced', async () => {
    const { pool, ymusd, savings, lp, lp2, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 5000);
    await pool.connect(keeper).invest(E18('5000'));
    await savings.accrue(await poolAddr(pool), E18('100'));     // yield lands in the vault
    await pool.connect(lp2).deposit(E18('10100'));              // harvest first: lp2 pays the post-yield price
    expect(await pool.totalSavingsYield()).to.equal(E18('100'));
    expect(await ymusd.balanceOf(lp2.address)).to.equal(E18('10000'));  // 10,100 MUSD at 1.01 per share
    expect(await pool.totalAssets()).to.equal(E18('20200'));
    // the first LP keeps the yield: 10,000 shares now redeem 10,100 MUSD
    expect((await pool.netAssetValue()) * (await ymusd.balanceOf(lp.address)) / (await ymusd.totalSupply())).to.equal(E18('10100'));
  });

  it('divest returns principal and books any yield paid with it; guardian may divest', async () => {
    const { pool, savings, guardian, keeper, lp } = await deploy();
    await pool.setSavings(await savings.getAddress(), 5000);
    await pool.connect(keeper).invest(E18('4000'));
    await savings.accrue(await poolAddr(pool), E18('40'));
    await expect(pool.connect(lp).divest(1)).to.be.revertedWith('not keeper');
    await pool.connect(guardian).divest(ethers.MaxUint256);     // more than invested = all
    expect(await pool.invested()).to.equal(0n);
    expect(await pool.totalSavingsYield()).to.equal(E18('40'));
    expect(await pool.totalAssets()).to.equal(E18('10040'));
  });

  it('a vault that short-pays principal is refused', async () => {
    const { pool, savings, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 5000);
    await pool.connect(keeper).invest(E18('1000'));
    await savings.setShortPay(true);
    await expect(pool.connect(keeper).divest(E18('1000'))).to.be.revertedWith('savings short');
  });

  it('a broken vault never blocks exercise, sell-back, refunds or deposits; only withdrawals beyond cash wait', async () => {
    const { pool, musd, ymusd, oracle, savings, lp, lp2, buyer, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 5000);
    const a = await buyPut(pool, buyer);                         // three live pool options
    const b = await buyPut(pool, buyer);
    const c = await buyPut(pool, buyer, '100000', '0.01', 0.02); // ~29 minutes
    await pool.connect(keeper).invest((await pool.totalAssets() - await pool.lockedCollateral()) / 2n);
    await savings.setBroken(true);

    await oracle.setPrice(90000);                                 // puts in the money
    await pool.connect(buyer).settle(a);                          // exercise
    expect((await pool.getOption(a)).status).to.equal(2n);
    await pool.connect(buyer).sellBack(b, 0);                     // sell back
    expect((await pool.getOption(b)).status).to.equal(4n);
    await ethers.provider.send('evm_increaseTime', [1800]); await ethers.provider.send('evm_mine');
    await pool.refund(c);                                         // refund after expiry
    expect((await pool.getOption(c)).status).to.equal(3n);
    await pool.connect(lp2).deposit(E18('100'));                  // deposits still work (harvest is skipped)

    const cashNow = await cash(musd, pool);
    await expect(pool.connect(lp).withdraw(await ymusd.balanceOf(lp.address))).to.be.revertedWith('savings broken');
    // a withdrawal the pool can pay from its own cash still works
    const small = (await ymusd.totalSupply()) * (cashNow / 2n) / (await pool.netAssetValue());
    await pool.connect(lp).withdraw(small);
  });

  it('the performance fee includes savings yield but is only ever paid from cash, never by calling the vault', async () => {
    const { pool, musd, savings, oracle, buyer, keeper } = await deploy();
    await pool.setSavings(await savings.getAddress(), 8000);
    await pool.connect(keeper).invest(E18('8000'));
    await savings.accrue(await poolAddr(pool), E18('500'));
    await pool.connect(keeper).divest(E18('1'));                  // books the 500 yield
    const id = await buyPut(pool, buyer);
    await savings.setBroken(true);
    await oracle.setPrice(110000);                                // put out of the money
    await ethers.provider.send('evm_increaseTime', [86400 + 1]); await ethers.provider.send('evm_mine');
    await pool.refund(id);                                        // takes the performance fee: must not call the vault
    expect(await pool.totalPerformanceFeePaid()).to.be.gt(0n);
    expect(await cash(musd, pool)).to.be.gte(await pool.lockedCollateral());
  });
});
