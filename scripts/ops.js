/**
 * ops.js — everything that should run on a server for Piton V2 (ethers only, no Hardhat).
 *
 *   node scripts/ops.js                 # run all jobs forever (use pm2 on a VPS)
 *   ONCE=1 node scripts/ops.js          # run each job once, then exit (smoke test)
 *   JOBS=iv,exercise node scripts/ops.js
 *   DRY_RUN=1 ...                       # log decisions without sending transactions
 *
 * Jobs (key in brackets):
 *   iv        hourly: set the pool IV from Deribit DVOL                          [keeper]
 *   exercise  every minute: exercise opted-in in-the-money options in the last 5 min (earns the keeper tip) [keeper]
 *   refund    every 5 min: refund expired pool options (frees collateral, books yield) [keeper]
 *   poke      every 10 min: feed the circuit breaker a fresh price                [keeper]
 *   bot       every BOT_MS (default 12 min): small demo trades by a few test wallets [bots]
 *
 * Keys are read from git-ignored files, never from this repo:
 *   docs/governance-wallets.json  (scripts/genKeys.js)   keeper = IV + exercise + refund + poke
 *   docs/bot-wallets.json                                bots   = demo traders (first BOT_COUNT, default 3)
 * Env overrides: POOL, RPC, KEEPER_KEY, BOT_COUNT, BOT_MS, JOBS, ONCE, DRY_RUN.
 * The IV keeper key must be the pool owner or the address set with setIvKeeper.
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { latestDvol, planUpdate, isStale } = require('./lib/iv');

const ROOT = path.join(__dirname, '..');
const RPC = process.env.RPC || 'https://rpc.test.mezo.org';
const DRY = !!process.env.DRY_RUN;
const ONCE = !!process.env.ONCE;
const JOBS = (process.env.JOBS || 'iv,exercise,refund,poke,bot').split(',');
const SCAN = 300; // newest option ids examined per sweep (options live at most 14 days)
const DVOL_URL = 'https://www.deribit.com/api/v2/public/get_volatility_index_data';
const MUSD = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';

const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const abi = readJson('client/src/contracts/OptionPool.json').abi;
const poolAddr = process.env.POOL || require('./lib/deployments').load('matsnet').pool;
const provider = new ethers.JsonRpcProvider(RPC);
const keeper = new ethers.Wallet(process.env.KEEPER_KEY || readJson('docs/governance-wallets.json').keeper.privateKey, provider);
const poolK = new ethers.Contract(poolAddr, abi, keeper);
const botN = Number(process.env.BOT_COUNT || 3);
const bots = JOBS.includes('bot') ? readJson('docs/bot-wallets.json').bots.slice(0, botN).map(b => new ethers.Wallet(b.privateKey, provider)) : [];

const log = (job, msg) => console.log(`[${new Date().toISOString()}] ${job.padEnd(8)} ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.random() * (b - a) + a;
const pick = a => a[Math.floor(Math.random() * a.length)];
const why = e => e.reason || e.shortMessage || (e.message || String(e)).slice(0, 100);
const E18 = ethers.parseEther;

// The keeper wallet sends from several jobs; run them one at a time so nonces never collide.
let chain = Promise.resolve();
const keeperQueue = fn => (chain = chain.then(fn, fn));

async function recent(pool) {
  const next = Number(await pool.nextId());
  const ids = [];
  for (let id = next - 1; id >= Math.max(1, next - SCAN); id--) ids.push(id);
  return ids;
}

// ── keeper jobs ──────────────────────────────────────────────────────────────

async function ivJob() {
  const end = Date.now();
  const url = `${DVOL_URL}?currency=BTC&start_timestamp=${end - 6 * 3600e3}&end_timestamp=${end}&resolution=3600`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Deribit HTTP ${res.status}`);
  const dvol = latestDvol(await res.json());
  if (!dvol) throw new Error('no DVOL data');
  if (isStale(dvol.ts, Date.now())) throw new Error('DVOL data is stale');
  const plan = planUpdate(dvol.pct, await poolK.iv(), Number(process.env.MIN_CHANGE || 2));
  log('iv', `DVOL ${dvol.pct}% | on-chain ${plan.currentPct}% -> ${plan.targetPct}% ${plan.update ? '' : '(no change)'}`);
  if (!plan.update || DRY) return;
  await (await poolK.setIV(plan.targetWei)).wait();
  log('iv', 'updated');
}

async function exerciseJob() {
  const now = (await provider.getBlock('latest')).timestamp;
  const window = Number(await poolK.AUTO_EXERCISE_WINDOW());
  const spot = await poolK.spotPrice();
  let n = 0;
  for (const id of await recent(poolK)) {
    const o = await poolK.getOption(id);
    const left = Number(o.expiry) - now;
    if (Number(o.status) !== 1 || left <= 0 || left > window) continue;
    if (!(await poolK.autoExercise(id))) continue;
    const itm = Number(o.optionType) === 0 ? spot > o.strike : spot < o.strike;
    if (!itm) continue;
    log('exercise', `#${id} in the money, ${left}s left`);
    if (DRY) continue;
    try { await (await poolK.settleFor(id)).wait(); n++; log('exercise', `#${id} exercised`); }
    catch (e) { log('exercise', `#${id} skipped: ${why(e)}`); }
  }
  if (!n) log('exercise', 'nothing to do');
}

async function refundJob() {
  const now = (await provider.getBlock('latest')).timestamp;
  let n = 0;
  for (const id of await recent(poolK)) {
    const o = await poolK.getOption(id);
    if (Number(o.status) !== 1 || Number(o.expiry) > now) continue;
    log('refund', `#${id} expired`);
    if (DRY) continue;
    try { await (await poolK.refund(id)).wait(); n++; } catch (e) { log('refund', `#${id} skipped: ${why(e)}`); }
  }
  if (!n) log('refund', 'nothing to do');
}

async function pokeJob() {
  if (DRY) return log('poke', 'dry run');
  await (await poolK.pokeCircuitBreaker.send()).wait();
  const until = Number(await poolK.cbUntil());
  log('poke', until > Date.now() / 1000 ? `BREAKER ACTIVE until ${new Date(until * 1000).toISOString()}` : 'ok');
}

// ── demo trader ──────────────────────────────────────────────────────────────

async function botJob() {
  if (!bots.length) return;
  const wallet = pick(bots);
  const pool = poolK.connect(wallet);
  const musd = new ethers.Contract(MUSD, ['function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], wallet);
  const who = wallet.address.slice(0, 8);

  // 1) tidy up: bots exercise their own in-the-money options that are not on auto-exercise
  const spot = await pool.spotPrice();
  const now = (await provider.getBlock('latest')).timestamp;
  for (const id of await recent(pool)) {
    const o = await pool.getOption(id);
    if (Number(o.status) !== 1 || o.long !== wallet.address || Number(o.expiry) <= now) continue;
    const itm = Number(o.optionType) === 0 ? spot > o.strike : spot < o.strike;
    if (itm && !(await pool.autoExercise(id)) && !DRY) {
      try { await (await pool.settle(id)).wait(); log('bot', `${who} exercised #${id}`); } catch (e) { log('bot', `settle #${id}: ${why(e)}`); }
    }
  }

  // 2) place one small order against the pool, unless the pool is busy
  const [assets, locked] = await Promise.all([pool.totalAssets(), pool.lockedCollateral()]);
  if (assets === 0n || locked * 100n / assets > 60n) return log('bot', 'pool busy or empty; skipping');
  const isCall = Math.random() < 0.5;
  const strike = BigInt(Math.round(Number(ethers.formatEther(spot)) * rand(0.93, 1.07))) * 10n ** 18n;
  const qty = E18(rand(0.001, 0.003).toFixed(4));
  const expiry = now + pick([1200, 3600, 3 * 3600, 6 * 3600, 24 * 3600]);
  let quote;
  try { quote = await pool.quotePremium(isCall, strike, qty, expiry); } catch (e) { return log('bot', `quote failed: ${why(e)}`); }
  const premium = quote * 102n / 100n;
  if ((await musd.balanceOf(wallet.address)) < premium) return log('bot', `${who} out of MUSD`);
  log('bot', `${who} ${isCall ? 'call' : 'put'} K=${ethers.formatEther(strike)} q=${ethers.formatEther(qty)} exp=${Math.round((expiry - now) / 60)}m premium=${ethers.formatEther(premium)}`);
  if (DRY) return;
  if ((await musd.allowance(wallet.address, poolAddr)) < premium) await (await musd.approve(poolAddr, ethers.MaxUint256)).wait();
  await (await pool.createLongOrder(isCall ? 0 : 1, strike, qty, expiry, premium)).wait();
  const id = (await pool.nextId()) - 1n;
  const o = await pool.getOption(id);
  if (!o.filledByPool) return log('bot', `#${id} not filled by the pool; left as a bid`);
  const auto = Math.random() < 0.6; // most bots rely on the keeper, like a real user who ticks the box
  if (auto) await (await pool.setAutoExercise(id, true)).wait();
  log('bot', `#${id} filled by pool${auto ? ', auto-exercise on' : ''}`);
}

// ── scheduler ────────────────────────────────────────────────────────────────

const schedule = {
  iv:       { every: 60 * 60e3,  fn: ivJob,       keeper: true },
  exercise: { every: 60e3,       fn: exerciseJob, keeper: true },
  refund:   { every: 5 * 60e3,   fn: refundJob,   keeper: true },
  poke:     { every: 10 * 60e3,  fn: pokeJob,     keeper: true },
  bot:      { every: Number(process.env.BOT_MS || 12 * 60e3), fn: botJob, keeper: false },
};

async function run(name) {
  const job = schedule[name];
  const task = async () => { try { await job.fn(); } catch (e) { log(name, `error: ${why(e)}`); } };
  return job.keeper ? keeperQueue(task) : task();
}

async function main() {
  log('ops', `pool ${poolAddr} | keeper ${keeper.address} | bots ${bots.length} | jobs ${JOBS.join(',')}${DRY ? ' | DRY RUN' : ''}`);
  if (ONCE) { for (const j of JOBS) await run(j); await chain; return; }
  for (const j of JOBS) { await run(j); setInterval(() => run(j), schedule[j].every); await sleep(1500); }
}

main().catch(e => { console.error(e); process.exit(1); });
