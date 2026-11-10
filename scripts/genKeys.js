// Generates the operating keys (keeper, guardian, governance) and saves them to
// docs/governance-wallets.json, which is git-ignored (docs/ is in .gitignore), exactly like
// docs/bot-wallets.json. Prints only public addresses.
//
//   node scripts/genKeys.js              # create the file (refuses to overwrite)
//   FUND=1 node scripts/genKeys.js       # also send gas from the master wallet in docs/bot-wallets.json
//   FUND_BOTS=3 BOT_MUSD=50 FUND=1 ...   # also send MUSD to the first 3 bot wallets
//
// Roles:
//   keeper    - sets IV, exercises opted-in options, pokes the circuit breaker (VPS). Gas only.
//   guardian  - can only pause the pool. Keep it offline except in an emergency.
//   multisig  - proposer+executor of the timelock. On testnet a single key; use a Safe on mainnet.

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const FILE = path.join(__dirname, '../docs/governance-wallets.json');
const BOTS = path.join(__dirname, '../docs/bot-wallets.json');
const RPC = process.env.RPC || 'https://rpc.test.mezo.org';
const MUSD = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
const GAS = { keeper: '0.005', guardian: '0.002', multisig: '0.004' };

async function main() {
  let w;
  if (fs.existsSync(FILE)) {
    w = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    console.log('using existing', path.relative(process.cwd(), FILE));
  } else {
    w = {};
    for (const role of Object.keys(GAS)) {
      const k = ethers.Wallet.createRandom();
      w[role] = { address: k.address, privateKey: k.privateKey };
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(w, null, 2), { mode: 0o600 });
    console.log('created', path.relative(process.cwd(), FILE), '(git-ignored, mode 600)');
  }
  for (const role of Object.keys(GAS)) console.log(role.padEnd(9), w[role].address);

  if (!process.env.FUND) return console.log('\nNot funding (set FUND=1 to send gas from the master wallet).');

  const bots = JSON.parse(fs.readFileSync(BOTS, 'utf8'));
  const provider = new ethers.JsonRpcProvider(RPC);
  const master = new ethers.Wallet(bots.master.privateKey, provider);
  const musd = new ethers.Contract(MUSD, ['function transfer(address,uint256) returns (bool)'], master);
  for (const role of Object.keys(GAS)) {
    const bal = await provider.getBalance(w[role].address);
    if (bal >= ethers.parseEther(GAS[role]) / 2n) { console.log(role, 'already has gas'); continue; }
    await (await master.sendTransaction({ to: w[role].address, value: ethers.parseEther(GAS[role]) })).wait();
    console.log(`sent ${GAS[role]} BTC gas to ${role}`);
  }
  const n = Number(process.env.FUND_BOTS || 0);
  for (const b of bots.bots.slice(0, n)) {
    const amt = ethers.parseEther(process.env.BOT_MUSD || '50');
    await (await musd.transfer(b.address, amt)).wait();
    console.log(`sent ${ethers.formatEther(amt)} MUSD to bot ${b.address.slice(0, 8)}`);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
