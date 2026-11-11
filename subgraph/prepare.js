// Writes subgraph.yaml from subgraph.template.yaml using the current deployment
// (../deployments/<NETWORK>.json): pool address and start block. If the deployment file has no
// deployBlock, the block where the pool's code first appears is found by binary search over RPC.
//
//   NETWORK=matsnet node prepare.js      (default matsnet; mainnet uses NETWORK=mainnet)
const fs = require('fs');
const path = require('path');

const NETWORK = process.env.NETWORK || 'matsnet';
const MAP = {
  matsnet: { graph: 'mezo-testnet', rpc: 'https://rpc.test.mezo.org' },
  mainnet: { graph: 'mezo-mainnet', rpc: 'https://mainnet.mezo.public.validationcloud.io' },
};

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function findDeployBlock(url, address) {
  let hi = parseInt(await rpc(url, 'eth_blockNumber', []), 16), lo = 0;
  if ((await rpc(url, 'eth_getCode', [address, '0x' + hi.toString(16)])).length <= 2) throw new Error(`no contract at ${address}`);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    let code = '0x';
    try { code = await rpc(url, 'eth_getCode', [address, '0x' + mid.toString(16)]); } catch { /* pruned: treat as absent */ }
    if (code.length > 2) hi = mid; else lo = mid;
  }
  return hi;
}

async function main() {
  const net = MAP[NETWORK];
  if (!net) throw new Error(`unknown NETWORK ${NETWORK}`);
  const file = path.join(__dirname, '..', 'deployments', `${NETWORK}.json`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.pool || '')) throw new Error(`no pool address in ${file}`);
  let startBlock = Number(d.deployBlock);
  if (!(startBlock > 0)) {
    startBlock = await findDeployBlock(net.rpc, d.pool);
    console.log(`deployBlock not in ${path.basename(file)}; found ${startBlock} on-chain`);
  }
  const out = fs.readFileSync(path.join(__dirname, 'subgraph.template.yaml'), 'utf8')
    .replace(/{{network}}/g, net.graph).replace(/{{address}}/g, d.pool).replace(/{{startBlock}}/g, String(startBlock));
  fs.writeFileSync(path.join(__dirname, 'subgraph.yaml'), out);
  console.log(`subgraph.yaml: ${net.graph} pool ${d.pool} from block ${startBlock}`);
  return { network: NETWORK, pool: d.pool, startBlock };
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main };
