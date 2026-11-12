// Suggestion #10: two-step ownership, guardian pause, timelocked admin.
const { expect } = require('chai');
const { poolFactory } = require('./helpers/poolFactory');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { POOL_ERRORS } = require('./helpers/poolErrors');
const E18 = ethers.parseEther;

async function deploy() {
  const [owner, guardian, multisig, other] = await ethers.getSigners();
  const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
  const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  const pool = await (await poolFactory()).deploy(
    await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
    await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
    await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
  return { pool, owner, guardian, multisig, other };
}

describe('#10 governance', () => {
  it('ownership moves in two steps: a typo address cannot take over', async () => {
    const { pool, owner, other } = await deploy();
    await pool.transferOwnership(other.address);
    expect(await pool.owner()).to.equal(owner.address);        // not yet
    await expect(pool.connect(owner).acceptOwnership()).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    await pool.connect(other).acceptOwnership();
    expect(await pool.owner()).to.equal(other.address);
  });
  it('renouncing ownership is disabled', async () => {
    const { pool } = await deploy();
    await expect(pool.renounceOwnership()).to.be.revertedWithCustomError(POOL_ERRORS, 'RenounceDisabled');
  });
  it('a guardian can pause but nothing else', async () => {
    const { pool, guardian, other } = await deploy();
    await expect(pool.connect(guardian).pausePool()).to.be.revertedWithCustomError(POOL_ERRORS, 'NotOwnerOrGuardian');
    await expect(pool.connect(other).setGuardian(other.address)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    await expect(pool.setGuardian(guardian.address)).to.emit(pool, 'GuardianSet').withArgs(guardian.address);
    await expect(pool.connect(guardian).pausePool()).to.emit(pool, 'PausedSet').withArgs(true);
    await expect(pool.connect(guardian).unpausePool()).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    await expect(pool.connect(guardian).setIvSpreadBps(0)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    await pool.unpausePool();
  });
  it('with a timelock as owner, parameter changes wait for the delay; the guardian still pauses instantly', async () => {
    const { pool, guardian, multisig } = await deploy();
    const DELAY = 2 * 86400;
    const tl = await (await ethers.getContractFactory('PitonTimelock')).deploy(DELAY, [multisig.address], [multisig.address]);
    await pool.setGuardian(guardian.address);
    await pool.transferOwnership(await tl.getAddress());
    // the timelock accepts ownership through its own queue
    const accept = pool.interface.encodeFunctionData('acceptOwnership');
    const salt = ethers.ZeroHash;
    await tl.connect(multisig).schedule(await pool.getAddress(), 0, accept, ethers.ZeroHash, salt, DELAY);
    await time.increase(DELAY + 1);
    await tl.connect(multisig).execute(await pool.getAddress(), 0, accept, ethers.ZeroHash, salt);
    expect(await pool.owner()).to.equal(await tl.getAddress());

    // direct admin calls no longer work for the old owner
    await expect(pool.setIvSpreadBps(100)).to.be.revertedWithCustomError(pool, 'OwnableUnauthorizedAccount');
    // queued change: visible for the delay, then executable
    const call = pool.interface.encodeFunctionData('setIvSpreadBps', [2500]);
    const salt2 = ethers.id('spread');
    await tl.connect(multisig).schedule(await pool.getAddress(), 0, call, ethers.ZeroHash, salt2, DELAY);
    await expect(tl.connect(multisig).execute(await pool.getAddress(), 0, call, ethers.ZeroHash, salt2)).to.be.reverted;
    await time.increase(DELAY + 1);
    await tl.connect(multisig).execute(await pool.getAddress(), 0, call, ethers.ZeroHash, salt2);
    expect(await pool.ivSpreadBps()).to.equal(2500n);
    // emergency pause is not delayed
    await pool.connect(guardian).pausePool();
    expect(await pool.paused()).to.equal(true);
  });
});
