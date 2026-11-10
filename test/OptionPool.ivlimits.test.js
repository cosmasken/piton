// A stolen or buggy IV keeper may only move the price slowly: limited step per change and a minimum interval.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, keeper, other] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await ethers.getContractFactory('OptionPool')).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  await pool.setIvKeeper(keeper.address);
  return { pool, owner, keeper, other };
}

describe('IV keeper limits', () => {
  it('defaults: 15% per change, at most once every 50 minutes', async () => {
    const { pool } = await deploy();
    expect(await pool.maxIvStepBps()).to.equal(1500n);
    expect(await pool.ivMinInterval()).to.equal(3000n);
  });

  it('keeper cannot jump IV: a 25% floor grab is refused', async () => {
    const { pool, keeper } = await deploy();           // iv = 80%
    await expect(pool.connect(keeper).setIV(E18('0.25'))).to.be.revertedWith('iv step too large');
    await expect(pool.connect(keeper).setIV(E18('0.67'))).to.be.revertedWith('iv step too large'); // -16.25%
    await pool.connect(keeper).setIV(E18('0.68'));                                                  // -15% exactly
    expect(await pool.iv()).to.equal(E18('0.68'));
  });

  it('keeper cannot update twice in a row; can again after the interval', async () => {
    const { pool, keeper } = await deploy();
    await pool.connect(keeper).setIV(E18('0.7'));
    await expect(pool.connect(keeper).setIV(E18('0.65'))).to.be.revertedWith('iv updated too recently');
    await time.increase(3001);
    await pool.connect(keeper).setIV(E18('0.65'));
  });

  it('walking from 80% to the 25% floor takes the keeper many hours', async () => {
    const { pool, keeper } = await deploy();
    let steps = 0, cur = 0.8;
    while (cur > 0.26 && steps < 20) {
      const next = Math.max(0.25, cur * 0.851);
      await pool.connect(keeper).setIV(E18(next.toFixed(6)));
      cur = next; steps++;
      await time.increase(3001);
    }
    expect(steps).to.be.gte(7);   // at least ~7 hours, long enough to notice and pause or revoke
  });

  it('the owner is not limited (owner already sits behind the timelock)', async () => {
    const { pool, owner } = await deploy();
    await pool.connect(owner).setIV(E18('0.3'));
    await pool.connect(owner).setIV(E18('1.2'));
    expect(await pool.iv()).to.equal(E18('1.2'));
  });

  it('a keeper update after an owner change still respects the interval', async () => {
    const { pool, owner, keeper } = await deploy();
    await pool.connect(owner).setIV(E18('0.5'));
    await expect(pool.connect(keeper).setIV(E18('0.52'))).to.be.revertedWith('iv updated too recently');
  });

  it('limits are bounded, owner-only and emit an event', async () => {
    const { pool, keeper } = await deploy();
    await expect(pool.setIvLimits(86401, 1500)).to.be.revertedWith('interval too long');
    await expect(pool.setIvLimits(3000, 99)).to.be.revertedWith('step out of range');
    await expect(pool.setIvLimits(3000, 5001)).to.be.revertedWith('step out of range');
    await expect(pool.setIvLimits(600, 3000)).to.emit(pool, 'IvLimitsSet').withArgs(600n, 3000n);
    await expect(pool.connect(keeper).setIvLimits(0, 5000)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
  });
});
