// Hand the pool to a timelock: deploys PitonTimelock, sets the guardian, starts the two-step
// ownership transfer and queues the timelock's acceptance.
//
//   (addresses default to docs/governance-wallets.json from scripts/genKeys.js)
//   MULTISIG=0x... GUARDIAN=0x... DELAY_HOURS=48 npx hardhat run scripts/setupGovernance.js --network matsnet
//
// After DELAY_HOURS the multisig (proposer+executor) runs `execute` on the queued acceptance; the
// printed calldata/salt make that a single call. Until then the current owner stays in control.
//   POOL   OptionPool address (default: deployments/<network>.json)

const { ethers, network } = require('hardhat');
const deployments = require('./lib/deployments');

async function main() {
  // Addresses come from the environment, or from docs/governance-wallets.json (node scripts/genKeys.js)
  let saved = {};
  try { saved = require('../docs/governance-wallets.json'); } catch {}
  const MULTISIG = process.env.MULTISIG || (saved.multisig && saved.multisig.address);
  const GUARDIAN = process.env.GUARDIAN || (saved.guardian && saved.guardian.address);
  if (!ethers.isAddress(MULTISIG || '') || !ethers.isAddress(GUARDIAN || '')) throw new Error('Set MULTISIG and GUARDIAN addresses');
  const delay = Math.round(Number(process.env.DELAY_HOURS || 48) * 3600);
  const poolAddr = process.env.POOL || deployments.load(network.name).pool;
  const [owner] = await ethers.getSigners();
  const pool = await ethers.getContractAt('OptionPool', poolAddr, owner);

  const tl = await (await ethers.getContractFactory('PitonTimelock')).deploy(delay, [MULTISIG], [MULTISIG]);
  await tl.waitForDeployment();
  const tlAddr = await tl.getAddress();
  console.log('PitonTimelock:', tlAddr, `(delay ${delay / 3600}h)`);

  await (await pool.setGuardian(GUARDIAN)).wait();
  console.log('guardian set:', GUARDIAN);
  await (await pool.transferOwnership(tlAddr)).wait();
  console.log('ownership transfer started (pending acceptance by the timelock)');
  console.log('\nNext: from the multisig, schedule then (after the delay) execute on', tlAddr);
  console.log('  target :', poolAddr);
  console.log('  data   :', pool.interface.encodeFunctionData('acceptOwnership'));
  console.log('  predecessor 0x00..00, salt 0x00..00, delay', delay);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
