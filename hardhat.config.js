require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || '0'.repeat(64);

module.exports = {
  solidity: {
    version: '0.6.12',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
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
