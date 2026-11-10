// Auto-exercise keeper: exercises in-the-money options whose owner opted in, during the last
// 5 minutes before expiry, and earns the keeper fee (0.5% of the payout by default).
//
//   npx hardhat run scripts/autoExercise.js --network matsnet
//
// Run every minute or two from cron. Any funded account works (no special role). Env:
//   POOL      OptionPool address (default: deployments/<network>.json)
//   DRY_RUN=1 list what would be exercised without sending

const { ethers, network } = require('hardhat');
const deployments = require('./lib/deployments');

async function main() {
  const poolAddr = process.env.POOL || deployments.load(network.name).pool;
  if (!poolAddr || !ethers.isAddress(poolAddr)) throw new Error('Set POOL to the OptionPool address');
  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt('OptionPool', poolAddr, signer);

  const window = Number((await pool.AUTO_EXERCISE_WINDOW()));
  const now = (await ethers.provider.getBlock('latest')).timestamp;
  const spot = await pool.spotPrice();
  const next = Number(await pool.nextId());
  let sent = 0;
  // Scan recent ids newest-first; options live at most 14 days, so a bounded scan is enough.
  for (let id = next - 1; id >= Math.max(1, next - 2000); id--) {
    const o = await pool.getOption(id);
    if (Number(o.status) !== 1) continue;                                   // FILLED only
    const left = Number(o.expiry) - now;
    if (left <= 0 || left > window) continue;
    if (!(await pool.autoExercise(id))) continue;
    const itm = o.optionType === 0n ? spot > o.strike : spot < o.strike;
    if (!itm) continue;
    console.log(`#${id} ${o.optionType === 0n ? 'CALL' : 'PUT'} K=${ethers.formatEther(o.strike)} in the money, ${left}s left`);
    if (process.env.DRY_RUN) continue;
    try { const tx = await pool.settleFor(id); await tx.wait(); sent++; console.log('  exercised:', tx.hash); }
    catch (e) { console.log('  skipped:', e.shortMessage || e.message); }
  }
  console.log(sent ? `exercised ${sent}` : 'nothing to exercise');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
