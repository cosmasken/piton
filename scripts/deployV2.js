// Deploy yMUSD + OptionPool and wire them together.
//
//   npx hardhat run scripts/deployV2.js --network matsnet
//
// Env: KEEPER=0x...  optional IV keeper address (can only call setIV)
// Writes deployments/<network>.json, which seedV2.js / health.js / ivKeeper.js read.
// After deploying, put the pool/ymusd addresses in client/src/network.mjs (replacing the zero
// placeholders on a new network) and the README table.

const { ethers, network } = require('hardhat');
const deployments = require('./lib/deployments');

async function main() {
  const known = deployments.load(network.name);
  for (const k of ['musd', 'oracle', 'troveManager', 'borrowerOperationsSignatures']) {
    if (!known[k]) throw new Error(`Missing ${k} address for network ${network.name} in scripts/lib/deployments.js`);
  }

  // Validate inputs before sending any transaction, so a typo cannot leave a half-wired deployment.
  const keeper = process.env.KEEPER;
  if (keeper && !ethers.isAddress(keeper)) throw new Error(`KEEPER is not a valid (checksummed) address: ${keeper}`);

  const [deployer] = await ethers.getSigners();
  console.log('network: ', network.name);
  console.log('deployer:', deployer.address);

  const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
  await ymusd.waitForDeployment();
  console.log('yMUSD:     ', await ymusd.getAddress());

  const pool = await (await ethers.getContractFactory('OptionPool')).deploy(
    known.musd, await ymusd.getAddress(), known.oracle, known.troveManager, known.borrowerOperationsSignatures
  );
  await pool.waitForDeployment();
  console.log('OptionPool:', await pool.getAddress());

  await (await ymusd.setPool(await pool.getAddress())).wait();
  console.log('yMUSD pool set');

  // Save as soon as the core contracts exist, before optional steps.
  const file = deployments.save(network.name, {
    pool: await pool.getAddress(),
    ymusd: await ymusd.getAddress(),
  });
  console.log('saved', file);
  console.log(`next: set ${network.name} pool/ymusd in client/src/network.mjs, then rebuild the client`);

  if (keeper) {
    await (await pool.setIvKeeper(keeper)).wait();
    console.log('ivKeeper:  ', keeper);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
