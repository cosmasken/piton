// Shared deployment address book: scripts/deployV2.js writes deployments/<network>.json, other
// scripts read it. Falls back to the last known addresses so existing scripts keep working.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../deployments');

const KNOWN = {
  matsnet: {
    pool:         '0x7240a712402cd992881aE3b9dAA58955509ce582',
    ymusd:        '0x387A9D85541CE34082C2d9F0E618ac0a3D6A49DA',
    musd:         '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
    oracle:       '0x7b7c000000000000000000000000000000000015',
    troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
    borrowerOperationsSignatures: '0xD757e3646AF370b15f32EB557F0F8380Df7D639e',
  },
  // Mezo mainnet addresses from mezo-org/musd solidity/artifacts/deployments/mainnet
  mainnet: {
    musd:         '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
    oracle:       '0x7b7c000000000000000000000000000000000015',
    troveManager: '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193',
    borrowerOperationsSignatures: '0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a',
  },
};

function read(network) {
  const file = path.join(DIR, `${network}.json`);
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...(KNOWN[network] || {}), ...saved };
}

function load(network) {
  const a = read(network);
  if (!Object.keys(a).length) throw new Error(`No deployment addresses for network "${network}"`);
  return a;
}

function save(network, addrs) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${network}.json`);
  const merged = { ...read(network), ...addrs, deployedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return file;
}

module.exports = { load, save };
