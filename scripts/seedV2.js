const { ethers, network } = require('hardhat');

const deployments = require('./lib/deployments');

async function main() {
  const a = deployments.load(network.name);

  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt('OptionPool', a.pool, signer);
  const y    = await ethers.getContractAt('yMUSD', a.ymusd, signer);
  const musd = await ethers.getContractAt('MockERC20v2', a.musd, signer);

  const amount = ethers.parseEther(process.env.SEED || '1000');
  const [musdBefore, yBefore] = await Promise.all([
    musd.balanceOf(signer.address),
    y.balanceOf(signer.address),
  ]);

  console.log(`seeding ${ethers.formatEther(amount)} MUSD into ${a.pool}`);
  console.log(`before: MUSD ${ethers.formatEther(musdBefore)}  yMUSD ${ethers.formatEther(yBefore)}`);

  await (await musd.approve(a.pool, amount)).wait();
  const rc = await (await pool.deposit(amount)).wait();

  const [musdAfter, yAfter, total, supply] = await Promise.all([
    musd.balanceOf(signer.address),
    y.balanceOf(signer.address),
    pool.totalAssets(),
    y.totalSupply(),
  ]);

  console.log(`tx ${rc.hash}`);
  console.log(`after:  MUSD ${ethers.formatEther(musdAfter)}  yMUSD ${ethers.formatEther(yAfter)}`);
  console.log(`pool:   totalAssets ${ethers.formatEther(total)}  yMUSD supply ${ethers.formatEther(supply)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
