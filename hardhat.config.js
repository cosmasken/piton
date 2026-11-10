require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// When Mezo's MUSD contracts are present (tools/fetch-mezo.sh), Hardhat also compiles each
// OpenZeppelin file they import as its own root, picking the highest compiler (0.8.28/london).
// OZ 5.6 Strings -> Bytes uses `mcopy`, which needs cancun. Route those OZ roots to the 0.8.24/cancun
// compiler. Overrides only change each file's *own* artifact job; OptionPool still compiles its
// dependencies inside its 0.8.28/london job, so production bytecode is unchanged.
function mezoOverrides() {
  if (!fs.existsSync(path.join(__dirname, 'contracts/mezo'))) return {};
  const cfg = { version: '0.8.24', settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 100 } } };
  const out = { 'contracts/test/MezoProxy.sol': cfg };
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (f.endsWith('.sol')) {
        const m = fs.readFileSync(f, 'utf8').match(/pragma solidity \^0\.8\.(\d+);/);
        if (m && Number(m[1]) <= 24) out[path.relative(path.join(__dirname, 'node_modules'), f)] = cfg;
      }
    }
  };
  for (const pkg of ['contracts', 'contracts-upgradeable']) walk(path.join(__dirname, 'node_modules/@openzeppelin', pkg));
  return out;
}

const PRIVATE_KEY = process.env.PRIVATE_KEY || '0'.repeat(64);

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: { evmVersion: 'london', viaIR: true, optimizer: { enabled: true, runs: 200 } },
      },
      {
        // Mezo MUSD protocol (contracts/mezo, fetched by tools/fetch-mezo.sh) pins 0.8.24
        version: '0.8.24',
        // cancun: OZ 5.6 Bytes.sol uses mcopy (Mezo itself targets london; irrelevant for in-process tests)
        settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 100 } },
      },
      {
        version: '0.6.12',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    ],
    overrides: mezoOverrides(),
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: true }, // Mezo BorrowerOperations/TroveManager exceed 24KB
    // Mezo matsnet (testnet) — chainId 31611
    matsnet: {
      url: 'https://rpc.test.mezo.org',
      chainId: 31611,
      accounts: [`0x${PRIVATE_KEY}`],
    },
    // Mezo mainnet — chainId 31612
    mainnet: {
      url: 'https://rpc.mezo.org',
      chainId: 31612,
      accounts: [`0x${PRIVATE_KEY}`],
    },
  },
};
