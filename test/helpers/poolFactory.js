// OptionPool links the PitonMath library (Black-Scholes maths moved out to stay under the 24 KB size limit).
// Deploys a fresh library each call so it lives inside each test's own fixture/snapshot.
const { ethers } = require('hardhat');

async function poolFactory(signer, name = 'OptionPool') {
  const lib = await (await ethers.getContractFactory('PitonMath', signer)).deploy();
  await lib.waitForDeployment();
  return ethers.getContractFactory(name, { signer, libraries: { PitonMath: await lib.getAddress() } });
}

module.exports = { poolFactory };
