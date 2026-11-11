// Build and deploy the subgraph for the current pool, then point the stable tag at it.
//
//   npm run deploy                     (from subgraph/, or `npm run subgraph:deploy` from the repo root)
//   NETWORK=mainnet npm run deploy
//   TAG=prod NAME=piton-testnet VERSION=1.20261111.1200 npm run deploy   (all optional)
//
// The dapp queries the TAG endpoint (…/<NAME>/<TAG>/gn), which never changes. Each run deploys a new
// version for whatever address deployments/<network>.json holds. The tag is moved to the new version
// only after it has finished syncing (WAIT_SYNC=0 moves it straight away).
const { execFileSync } = require('child_process');
const { main: prepare } = require('./prepare');

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: __dirname });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: __dirname, encoding: 'utf8' });

async function run() {
  const { network, pool } = await prepare();
  const NAME = process.env.NAME || (network === 'mainnet' ? 'piton' : 'piton-testnet');
  const TAG = process.env.TAG || 'prod';
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const VERSION = process.env.VERSION ||
    `1.${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const id = `${NAME}/${VERSION}`;

  sh('npx', ['graph', 'codegen']);
  sh('npx', ['graph', 'build']);
  sh('goldsky', ['subgraph', 'deploy', id, '--path', '.', '--description', `OptionPool ${pool}`]);

  if (process.env.WAIT_SYNC !== '0') {
    console.log(`waiting for ${id} to sync before moving the "${TAG}" tag (Ctrl-C to stop; the version stays deployed)`);
    for (;;) {
      const s = out('goldsky', ['subgraph', 'list', id]);
      // the CLI prints e.g. "Status: healthy  (Active)" and "Synced: 100%"
      if (/Status:\s*(failed|unhealthy)/i.test(s)) { console.log(s); throw new Error(`${id} failed to index; tag not moved`); }
      if (/Synced:\s*100%/i.test(s)) break;
      const m = /Synced:\s*([\d.]+%)/i.exec(s);
      console.log(`  synced ${m ? m[1] : '?'}`);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  sh('goldsky', ['subgraph', 'tag', 'create', id, '--tag', TAG]);
  console.log(`\n${id} deployed and tagged "${TAG}". The endpoint for the dapp ends in /${NAME}/${TAG}/gn`);
}

run().catch(e => { console.error(e.message); process.exit(1); });
