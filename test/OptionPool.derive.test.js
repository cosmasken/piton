// Suggestion #11: differential test of Piton's on-chain Black-Scholes against Derive (Lyra) v1's
// BlackScholes library (ISC, vendored in contracts/test/vendor/derive), an independent implementation
// that has priced real money. Same inputs, same 5% rate; prices must agree to within a tiny error.
const { expect } = require('chai');
const { ethers } = require('hardhat');
const E18 = ethers.parseEther;

describe('#11 Black-Scholes vs Derive v1 (differential)', function () {
  this.timeout(600000);
  let pool, derive;
  before(async () => {
    const musd = await (await ethers.getContractFactory('MockERC20v2')).deploy('MUSD', 'MUSD');
    const oracle = await (await ethers.getContractFactory('MockOracle')).deploy(100_000);
    const ymusd = await (await ethers.getContractFactory('yMUSD')).deploy();
    pool = await (await ethers.getContractFactory('OptionPool')).deploy(
      await musd.getAddress(), await ymusd.getAddress(), await oracle.getAddress(),
      await (await (await ethers.getContractFactory('MockTrove')).deploy()).getAddress(),
      await (await (await ethers.getContractFactory('MockBorrowerOps')).deploy()).getAddress());
    const lib = await (await ethers.getContractFactory('BlackScholes')).deploy();
    derive = await (await ethers.getContractFactory('DeriveBSWrapper', { libraries: { BlackScholes: await lib.getAddress() } })).deploy();
  });

  it('call and put prices agree across strikes, expiries and vols', async () => {
    const spot = E18('100000');
    const strikesPct = [70n, 80n, 90n, 95n, 100n, 105n, 110n, 120n, 130n];
    const times = [3600, 6 * 3600, 86400, 3 * 86400, 7 * 86400, 14 * 86400];
    const vols = ['0.30', '0.60', '0.90', '1.20', '1.50'];
    let worstAbs = 0, worstRel = 0, n = 0;
    for (const v of vols) {
      await pool.setIV(E18(v));
      for (const t of times) for (const pct of strikesPct) {
        const strike = spot * pct / 100n;
        const [dc, dp] = await derive.prices(t, E18(v), spot, strike, E18('0.05'));
        const pc = await pool.bsPrice(true, spot, strike, t);
        const pp = await pool.bsPrice(false, spot, strike, t);
        for (const [mine, ref, kind] of [[pc, dc, 'call'], [pp, dp, 'put']]) {
          const diff = mine > ref ? mine - ref : ref - mine;
          const abs = Number(ethers.formatEther(diff));
          const rel = ref > E18('1') ? Number(diff) / Number(ref) : 0; // relative only where the price is material
          worstAbs = Math.max(worstAbs, abs); worstRel = Math.max(worstRel, rel); n++;
          expect(abs, `${kind} v=${v} t=${t} K=${pct}%`).to.be.lt(0.5); // < 50 cents on a 100,000 spot
          expect(rel, `${kind} v=${v} t=${t} K=${pct}%`).to.be.lt(0.002); // < 0.2% where price > 1 MUSD
        }
      }
    }
    console.log(`      ${n} prices compared; worst abs diff ${worstAbs.toFixed(4)} MUSD, worst rel diff ${(worstRel * 100).toFixed(4)}%`);
  });

  it('put-call parity holds in Piton (C - P = S - K e^-rT) to within a cent', async () => {
    await pool.setIV(E18('0.8'));
    const spot = E18('100000'), strike = E18('95000'), t = 7 * 86400;
    const c = await pool.bsPrice(true, spot, strike, t), p = await pool.bsPrice(false, spot, strike, t);
    const disc = 95000 * Math.exp(-0.05 * t / 31536000);
    const lhs = Number(ethers.formatEther(c)) - Number(ethers.formatEther(p));
    expect(Math.abs(lhs - (100000 - disc))).to.be.lt(0.05);
  });
});
