// OptionPool reverts with custom errors (to stay under the 24 KB contract limit). Tests that do not hold a pool
// instance at the assertion can pass POOL_ERRORS to revertedWithCustomError: it only needs the pool's interface.
const { ethers } = require('hardhat');

const POOL_ERRORS = { interface: new ethers.Interface(require('../../artifacts/contracts/OptionPool.sol/OptionPool.json').abi) };

module.exports = { POOL_ERRORS };
