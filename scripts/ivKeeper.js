// IV keeper: sets OptionPool.iv from Deribit's BTC volatility index (DVOL), at most once per run.
//
//   npx hardhat run scripts/ivKeeper.js --network matsnet
//
// The signer must be the pool owner or the address set via `setIvKeeper` (recommended: a dedicated
// keeper key that can only change IV). Run hourly from cron. Env:
//   POOL           OptionPool address (default: deployments/<network>.json)
//   MIN_CHANGE     minimum change in vol points before sending a tx (default 2)
//   DRY_RUN=1      print the decision without sending

const { ethers, network } = require('hardhat');
const deployments = require('./lib/deployments');
const { latestDvol, planUpdate, isStale } = require('./lib/iv');

const DVOL_URL = 'https://www.deribit.com/api/v2/public/get_volatility_index_data';

async function fetchDvol() {
  const end = Date.now();
  const start = end - 6 * 3600 * 1000;
  const url = `${DVOL_URL}?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Deribit HTTP ${res.status}`);
  return latestDvol(await res.json());
}

async function main() {
  const poolAddr = process.env.POOL || deployments.load(network.name).pool;
  if (!poolAddr || !ethers.isAddress(poolAddr)) throw new Error('Set POOL to the OptionPool address');

  const dvol = await fetchDvol();
  if (!dvol) throw new Error('No DVOL data returned');
  if (isStale(dvol.ts, Date.now())) throw new Error(`DVOL data is stale (${new Date(dvol.ts).toISOString()})`);

  const [signer] = await ethers.getSigners();
  const pool = await ethers.getContractAt('OptionPool', poolAddr, signer);
  const current = await pool.iv();
  const plan = planUpdate(dvol.pct, current, Number(process.env.MIN_CHANGE || 2));
  const spread = Number(await pool.ivSpreadBps()) / 100;

  console.log(`DVOL ${dvol.pct}% @ ${new Date(dvol.ts).toISOString()} | on-chain ${plan.currentPct}% -> target ${plan.targetPct}% (sells at +${spread}%)`);
  if (!plan.update) { console.log('Change below threshold; no tx.'); return; }
  if (process.env.DRY_RUN) { console.log('DRY_RUN: not sending.'); return; }

  const tx = await pool.setIV(plan.targetWei);
  console.log('setIV tx:', tx.hash);
  await tx.wait();
  console.log('done');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
