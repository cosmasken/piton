const { ethers, network } = require('hardhat');

// Mezo contract addresses
const ADDRESSES = {
  31611: { musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503' }, // matsnet
  31612: { musd: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186' }, // mainnet
};

async function main() {
  const chainId = network.config.chainId;
  const { musd } = ADDRESSES[chainId];

  console.log(`Deploying to chainId ${chainId} (${network.name})...`);
  console.log(`  MUSD: ${musd}`);

  const [deployer] = await ethers.getSigners();
  console.log(`  Deployer: ${deployer.address}`);

  const CallOption = await ethers.getContractFactory('CallOption');
  const call = await CallOption.deploy(musd);
  await call.waitForDeployment();
  console.log(`CallOption deployed: ${await call.getAddress()}`);

  const PutOption = await ethers.getContractFactory('PutOption');
  const put = await PutOption.deploy(musd);
  await put.waitForDeployment();
  console.log(`PutOption  deployed: ${await put.getAddress()}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
