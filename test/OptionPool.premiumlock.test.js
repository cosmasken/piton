// Suggestion #1: unearned premium is not LP profit. These tests target the "become the pool" and
// "join just before expiry" attacks found while comparing Piton with Hegic and Derive.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const E18 = ethers.parseEther, f = v => Number(ethers.formatEther(v));

async function deploy() {
  const [owner, honest, attacker, other] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await ethers.getContractFactory('OptionPool')).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await ymusd.setPool(await pool.getAddress());
  await pool.setDepositLock(0); await pool.setWithdrawalFeeBps(0); // exit protections have their own tests
  await pool.setTVLCap(E18('1000000000'));
  await pool.setMaxOptionCollateral(E18('10000000'));
  for (const w of [owner, honest, attacker, other]) {
    await musd.mint(w.address, E18('10000000'));
    await musd.connect(w).approve(await pool.getAddress(), ethers.MaxUint256);
  }
  return { pool, musd, ymusd, oracle, owner, honest, attacker, other };
}
const now = async () => (await ethers.provider.getBlock('latest')).timestamp;
const lastId = async pool => (await pool.nextId()) - 1n;

describe('Premium lock: unearned premium is not LP profit', () => {
  const K = E18('100000'), Q = E18('0.01'); // 1-day at-the-money put on 0.01 BTC

  it('"become the pool": deposit, buy from the pool, withdraw at once -> no free option', async () => {
    const { pool, musd, ymusd, honest, attacker } = await deploy();
    await pool.connect(honest).deposit(E18('1000'));
    const before = await musd.balanceOf(attacker.address);
    await pool.connect(attacker).deposit(E18('9000')); // attacker owns 90% of the pool
    const exp = (await now()) + 86400;
    const premium = await pool.quotePremium(false, K, Q, exp);
    await pool.connect(attacker).createLongOrder(1, K, Q, exp, premium);
    expect((await pool.getOption(await lastId(pool))).filledByPool).to.equal(true);
    await pool.connect(attacker).withdraw(await ymusd.balanceOf(attacker.address));

    const cash = (await musd.balanceOf(attacker.address)) - before; // attacker's net cash, option still held
    // before the fix the attacker got ~88% of the premium back (net cost ~2 MUSD for a ~16.6 MUSD option)
    expect(-cash, 'attacker paid (almost) the full premium').to.be.gte(premium * 95n / 100n);
  });

  it('the honest LP receives the premium once the option expires worthless', async () => {
    const { pool, ymusd, honest, attacker } = await deploy();
    await pool.setRiskLimits(10000, 10000); // this test is not about the exposure limits
    await pool.connect(honest).deposit(E18('1000'));
    const exp = (await now()) + 86400;
    const premium = await pool.quotePremium(false, K, Q, exp);
    await pool.connect(attacker).createLongOrder(1, K, Q, exp, premium);
    const id = await lastId(pool);
    const net = premium * 98n / 100n;
    expect(await pool.netAssetValue(), 'premium is not profit yet').to.be.closeTo(E18('1000'), E18('0.05'));
    await time.increaseTo(exp + 1);
    expect(await pool.netAssetValue(), 'earned at expiry').to.be.closeTo(E18('1000') + net, E18('0.001'));
    await pool.refund(id);
    const worth = (await ymusd.balanceOf(honest.address)) * (await pool.netAssetValue()) / (await ymusd.totalSupply());
    // the LP keeps the premium minus the 15% performance fee on that yield
    expect(worth).to.be.closeTo(E18('1000') + net * 85n / 100n, E18('0.001'));
  });

  it('joining a minute before expiry captures almost none of the premium', async () => {
    const { pool, musd, ymusd, honest, attacker } = await deploy();
    await pool.connect(honest).deposit(E18('1000'));
    const exp = (await now()) + 86400;
    const premium = await pool.quotePremium(false, K, Q, exp);
    const other = (await ethers.getSigners())[3];
    await pool.connect(other).createLongOrder(1, K, Q, exp, premium);
    const net = premium * 98n / 100n;
    await time.increaseTo(exp - 60);
    const before = await musd.balanceOf(attacker.address);
    await pool.connect(attacker).deposit(E18('9000'));
    await time.increaseTo(exp + 1);
    await pool.connect(attacker).withdraw(await ymusd.balanceOf(attacker.address));
    const gain = (await musd.balanceOf(attacker.address)) - before;
    // a naive pool hands the newcomer ~90% of the premium for one minute of risk
    expect(gain).to.be.lt(net * 15n / 100n);
  });

  it('liability is the larger of exercise value and decayed premium', async () => {
    const { pool, oracle, honest, attacker } = await deploy();
    await pool.setRiskLimits(10000, 10000); // this test is not about the exposure limits
    await pool.connect(honest).deposit(E18('1000'));
    const exp = (await now()) + 86400;
    const premium = await pool.quotePremium(false, K, Q, exp);
    await pool.connect(attacker).createLongOrder(1, K, Q, exp, premium);
    const net = premium * 98n / 100n;
    const assets = await pool.totalAssets();
    expect(await pool.netAssetValue()).to.be.closeTo(assets - net, E18('0.001'));
    await time.increase(43200); // half the time left: premium has decayed to ~sqrt(0.5) = 71%
    const half = assets - (await pool.netAssetValue());
    expect(Number(half) / Number(net)).to.be.closeTo(Math.SQRT1_2, 0.01);
    await oracle.setPrice(80000); // now deep in the money: exercise value (0.01 * 20,000 = 200) dominates
    expect(await pool.netAssetValue()).to.equal(assets - E18('200'));
  });

  it('unrecognised premium is tracked and released when the option ends', async () => {
    const { pool, oracle, honest, attacker } = await deploy();
    await pool.connect(honest).deposit(E18('10000'));
    const exp = (await now()) + 3600;
    const premium = await pool.quotePremium(false, K, Q, exp);
    await pool.connect(attacker).createLongOrder(1, K, Q, exp, premium);
    await pool.connect(attacker).createLongOrder(1, K, Q, exp, premium);
    const idB = await lastId(pool);
    const netEach = async (i) => (await pool.getOption(i)).premium * 98n / 100n;
    expect((await pool.getOption(idB)).filledByPool).to.equal(true);
    expect(await pool.unrecognizedPremium()).to.be.closeTo((await netEach(idB)) + (await netEach(idB - 1n)), 10n);
    await oracle.setPrice(99000);
    await pool.connect(attacker).settle((await lastId(pool)) - 1n);
    expect(await pool.unrecognizedPremium()).to.be.closeTo(premium * 98n / 100n, 10n);
    await time.increaseTo(exp + 1);
    await pool.refund(await lastId(pool));
    expect(await pool.unrecognizedPremium()).to.equal(0n);
  });
});
