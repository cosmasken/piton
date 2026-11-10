const { ethers, network } = require('hardhat');

const deployments = require('./lib/deployments');

async function main() {
  const net = network.name;
  const addrs = deployments.load(net);

  const pool   = await ethers.getContractAt('OptionPool', addrs.pool);
  const ymusd  = await ethers.getContractAt('yMUSD', addrs.ymusd);
  const musd   = await ethers.getContractAt('MockERC20v2', addrs.musd);
  const oracle = await ethers.getContractAt('MockOracle', addrs.oracle);

  const provider = ethers.provider;
  const block    = await provider.getBlockNumber();
  const chainId  = (await provider.getNetwork()).chainId;

  const safe = async fn => { try { return await fn(); } catch (e) { return `ERR: ${e.shortMessage || e.message}`; } };

  const [round, dec, total, locked, util, nextId, paused, iv, tvlCap,
         pFee, perfFee, feeRecipient, poolMUSD, ySupply, poolOwner] = await Promise.all([
    safe(() => oracle.latestRoundData()),
    safe(() => oracle.decimals()),
    safe(() => pool.totalAssets()),
    safe(() => pool.lockedCollateral()),
    safe(() => pool.utilisation()),
    safe(() => pool.nextId()),
    safe(() => pool.paused()),
    safe(() => pool.iv()),
    safe(() => pool.tvlCap()),
    safe(() => pool.protocolFeeBps()),
    safe(() => pool.performanceFeeBps()),
    safe(() => pool.feeRecipient()),
    safe(() => musd.balanceOf(addrs.pool)),
    safe(() => ymusd.totalSupply()),
    safe(() => pool.owner()),
  ]);

  const f = n => {
    try { return ethers.formatEther(n); } catch { return String(n); }
  };
  const asNum = n => {
    try { return Number(ethers.formatEther(n)); } catch { return NaN; }
  };
  const available = await safe(() => pool.availableLiquidity());

  const answerVal  = round && round[1] != null ? round[1] : null;
  const updatedVal = round && round[3] != null ? round[3] : null;
  const oraclePrice = answerVal != null ? Number(ethers.formatUnits(answerVal, dec)) : NaN;
  const age = updatedVal != null ? Math.floor(Date.now() / 1000) - Number(updatedVal) : NaN;

  console.log(`\nPiton health — ${net} (chainId ${chainId})`);
  console.log('─'.repeat(52));
  console.log(`block                 ${block}`);
  console.log(`oracle BTC/USD        $${oraclePrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  const staleness = Number(await safe(() => pool.PRICE_STALENESS())) || 300;
  console.log(`oracle age            ${age}s ${age > staleness ? `(STALE > ${staleness}s, orders will revert)` : '(fresh)'}`);
  console.log(`pool owner            ${poolOwner}`);
  console.log(`fee recipient         ${feeRecipient}`);
  console.log(`totalAssets           ${f(total)} MUSD`);
  console.log(`lockedCollateral      ${f(locked)} MUSD`);
  console.log(`availableLiquidity    ${f(available)} MUSD`);
  console.log(`utilisation           ${(asNum(util) * 100).toFixed(2)}%`);
  console.log(`MUSD balance (pool)   ${f(poolMUSD)}`);
  console.log(`yMUSD totalSupply     ${f(ySupply)}`);
  console.log(`nextId                ${nextId}`);
  console.log(`paused                ${paused}`);
  console.log(`iv                    ${(asNum(iv) * 100).toFixed(2)}% mid / ${(asNum(await safe(() => pool.askIv())) * 100).toFixed(2)}% ask`);
  console.log(`ivKeeper              ${await safe(() => pool.ivKeeper())}`);
  console.log(`tvlCap                ${f(tvlCap)} MUSD`);
  console.log(`fees                  ${pFee} bps premium / ${perfFee} bps performance`);

  const n = Number(nextId || 0);
  if (n > 1) {
    console.log('\nrecent options:');
    for (let i = Math.max(1, n - 5); i < n; i++) {
      const o = await safe(() => pool.getOption(i));
      if (typeof o === 'string') continue;
      console.log(`  #${o.id}  type=${o.optionType}  status=${o.status}  pool=${o.filledByPool}  strike=${f(o.strike)}  qty=${f(o.quantity)}  expiry=${o.expiry}`);
    }
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
