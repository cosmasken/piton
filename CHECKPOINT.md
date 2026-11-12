# Checkpoint (end of 12 Nov 2026, 22:00 UTC)

Where the project stands, and what to pick up next. Read this first when resuming.

## Resume here
- **Deadline:** AKINDO Mezo Buildathon Wave 2, **15 Nov 2026 15:00 UTC** (18:00 the user's time, UTC+3).
- **Git:** on `main` @ `6e8e777`, working tree clean. Local `main` includes all Passport work (fast-forwarded from
  `feature/mezo-passport`, which still exists). **Not pushed:** `origin/main` is still the old `7cdb47c`; push only when
  the user says so (`git push origin main`). Judges see GitHub, so this matters before submission.
- **Live (Mezo testnet 31611), redeployed 12 Nov 21:30 UTC** with custom errors, resale on the book and grouped
  (per-series) liability:
  - OptionPool `0x016c05F75C9fF2141d06259A9e49DD9B949e18AA` (deploy block 16741716), linked to PitonMath
    `0xd628F2FA2142E757c447F9274Fd5E6BE5dcC332B`; yMUSD `0x61e29a7d0B87599244dAF46142C37B1738F7BE4b`.
  - Seeded 10,000 MUSD by the master `0x09aB…6D06`; IV 39%; `minPoolExpiry` 900 s; max 50 open series; keeper
    `0xdE33…7948`; sMUSD savings `0x6f46…8e16` at a 50% cap.
  - Deployed code matches the build (checked byte for byte; only the 33 immutable slots differ).
  - Previous pools are paused and emptied (`0x6D7F…8180`, `0x8544…5c2d`, and older).
- **Site:** https://piton.surge.sh (built from `main`). Subgraph `piton-testnet/1.20261112.2128`, tag `prod` points at it;
  it is the only version (Goldsky's limit is 3, delete old versions after each redeploy).
- **Tests:** Hardhat 180, Foundry 17, client 83, all passing. OptionPool 23,921 of 24,576 bytes (655 left).
- **Demo:** `scripts/demo.js` (git-ignored) passes all 13 scenes on the live site (2:08 at PACE=0.25 headless). Wallet
  reset with `SETUP=1` and ready (`PREFLIGHT=1` says ready): master 577 MUSD, Trove 225%, 0.0038 BTC gas.
  The user has already recorded the video (on the previous contract; the UI is the same apart from the new yield card).

## Waiting on the user (before submission)
1. **Re-push the VPS keeper** to the new pool: `./scripts/push-ops-vps.sh` (asks for the VPS password once). It also
   removes the old V1 bot (`pm2 delete piton-bot`). Until then: no IV updates, no auto-exercise, no sMUSD investing.
2. **Verify the 3 contracts** on the Mezo explorer from `docs/verify/` (git-ignored): `contracts.json` has addresses,
   compiler `v0.8.28+commit.7893614a`, optimizer 200 runs, viaIR, EVM london, constructor args (plain and encoded);
   one `*.standard-input.json` per contract ("Standard JSON input"). Order: PitonMath, yMUSD, OptionPool (OptionPool's
   input already links PitonMath).
3. **OK to push `main` to GitHub.**
4. **Submit the video** and the BUIDL text.
5. **Manual Bitcoin-wallet test** (Unisat, OKX, Xverse): connect, fund the Mezo account with BTC for gas, buy, sell back,
   exercise, LP deposit/withdraw, bid/cancel, Protect my Trove, 2-step Trove margin, resale list/buy, mainnet switch.
   WalletConnect: QR shows on the live site (Reown allowlist has piton.surge.sh); not yet scanned with a phone.

## Next for the agent (when the user resumes)
1. Update `docs/BUIDL.md` (git-ignored) for the new contract: addresses, Mezo Passport and Bitcoin wallets, resale on
   the book, per-series liability, APY card. Note that the first Trove-margin tx (`0x9a74…7e10df`) was on an earlier pool.
2. Just before submission: re-check Surge delivery (it served zero-filled gzip files on 12 Nov; a clean
   `rm -rf client/dist`, rebuild and redeploy fixed it). Fallback: Netlify (`netlify login` needed by the user), with
   piton.surge.sh forwarding there.
3. After 25 Nov: `node scripts/v1status.js`, then `node scripts/recover.js` (~393 MUSD locked in V1 CALL-A/PUT-A).
4. Roadmap (not started): governance handover to a real 2-of-3 Safe + timelock (`scripts/setupGovernance.js`, today's
   "multisig" in `docs/governance-wallets.json` is a single key); oracle cross-check (blocked: stale Pyth on Mezo);
   MEZO options (same blocker); mobile layout (deferred); audit before mainnet.

## Done 12 Nov (this session, newest last)
- Mezo Passport: wagmi 2.19.5, Passport 0.17.2, RainbowKit 2.2.11; Bitcoin wallets (Unisat/OKX/Xverse) via
  `PassportSigner` (`client/src/walletSigner.mjs`); wallet layer loads only on /dashboard and /stats; polyfills load
  first; Account panel shows Bitcoin address/balance, Mezo account (copy) and a low-gas warning; a note before each
  Bitcoin-wallet signature; Trove margin for Bitcoin wallets in two steps (borrow with `withdrawMUSD`, then a normal
  sale) because Mezo's WithdrawMUSD signature check is ECDSA only. WalletConnect ID in `client/.env` (git-ignored).
- `qr` pinned to 0.5.5 for RainbowKit's QR (`cuer` passes border 0, which qr 0.6+ rejects).
- Demo script: 5 s lead-in and 5 s tail, preflight check, MUSD top-up from pool shares in SETUP, failure screenshot at
  `/tmp/demo-failed.png`.
- Funds: borrowed 2,000 MUSD from the master Trove after adding 0.1 BTC collateral (Trove now 0.271 BTC, ~8,360 debt).
- Pool yield card (7d/30d annualised after 7 days of history, breakdown) and subgraph totals per hour/day (`f2380cc`).
- Custom errors in OptionPool (`009c45d`): `client/src/poolErrors.mjs` maps selectors to the old reason text; a test fails
  if a new error has no entry. Tests use `revertedWithCustomError(POOL_ERRORS, 'Name')` (`test/helpers/poolErrors.js`).
- Resale on the book (`95f03b0`): `listLong(id, price)` (0 delists), `buyListed(id, maxPrice)`; 2% fee on the price;
  auto-exercise resets for the new holder; subgraph `Resale` entity and `holderCost` for P&L.
- Grouped liability (`7071910`): `Series` totals per (type, strike, expiry), liability = min(collateral, max(size x
  intrinsic, min(premium, sqrt(time left) x weight))); `maxOpenSeries` (50, max 150) replaces `maxOpenPoolOptions`;
  25% exposure limit per series; views `openSeriesCount()`, `seriesCollateral(type, strike, expiry)`.
- Trove margin gas margin +30% (`9808bb1`): a live Trove sale reverted short of gas inside Mezo's call.

## Deployed 11 Nov 2026 (oracle-age change)
- Oracle price age: at most **30 s** (~7 Mezo blocks) to open or price risk (pool sales, orders, sell-back, deposits,
  quotes); **120 s** to exercise, so a short oracle hiccup near expiry does not cost a holder a winning option. Was 300 s.
  Measured: the Skip oracle updated every block (age 0 s) over 400 consecutive blocks and 1,001 samples across ~24 h.
- Deposits now revert "stale price" instead of going through on a stale price (stale NAV made shares look cheap).
- Removed the unused `userOptions` mapping / `getUserOptions` (saves ~20–40k gas per trade; nothing read it).
- After deploying: the VPS ops process must be re-pushed (`./scripts/push-ops-vps.sh`, the user does this) so the
  keeper and bot use the new pool; until then they act on the paused old pool and their transactions revert.

## Done recently
1. Twelve pool protections:
   - share price counts unearned premium as owed (NAV premium-lock)
   - deposit lock and exit fee
   - utilisation and per-option exposure limits
   - minimum rent
   - strike band
   - utilisation markup on price
   - minimum time left for pool sales
   - circuit breaker
   - opt-in auto-exercise
   - two-step ownership and guardian pause
   - Black-Scholes differential test against Derive v1
   - adjustable open-option cap
2. On-chain IV keeper limits: 15% per change, at most one change per 50 minutes.
3. Sell back to the pool:
   - `sellBack(id, minPayout)` and `quoteBuyback(id)`.
   - Price is mid-IV Black-Scholes value less a fixed 10% volatility spread, capped at the option's collateral.
   - Blocked while paused or while the circuit breaker is active.
4. Trading UI rebuild:
   - option chain by expiry, Buy/Sell form (market and limit), per-option order book
   - payoff chart, break-even, max loss and max gain
   - positions with mark price, P&L, greeks, sell back, auto-exercise toggle
   - recent trades, pool "How it works" panel
   - read-only browsing without a wallet, shareable `?i=` links
5. Operational scripts are untracked (git-ignored `scripts/`). Private notes are in `docs/OPERATIONS.md` (also git-ignored).

## Savings module (12 Nov, deployed)
- Black-Scholes maths moved into a linked library, `PitonMath` (OptionPool 24,203 -> 22,639 bytes; prices unchanged,
  Derive differential test passes). Deploys now need the library first (`scripts/deployV2.js` does it).
- Spare pool MUSD can go into Mezo's sMUSD (`0x6f46…8e16` on testnet): `setSavings`, `invest`/`divest` (owner or
  keeper; guardian may divest), cap ≤ 80% of free capital (default 50%). Locked collateral always stays as MUSD;
  payouts never call the vault; withdrawals and pool sales recall cash; yield collected before deposits/withdrawals;
  the performance fee includes savings yield but is only paid from cash. OptionPool 24,352 bytes.
- Tests: Hardhat 171 (9 new), Foundry 17 incl. two new invariants (MUSD here + savings == assets + user funds;
  locked collateral held as cash), with a vault that randomly breaks.
- Keeper job `savings` in ops.js (every 30 min to 90% of cap; daily yield via a 1-wei divest). Pool panel shows the
  invested amount and yield.
- Live on `0x016c…18AA`. The VPS keeper needs re-pushing (`./scripts/push-ops-vps.sh`, JOBS include `savings`).

## Times (11 Nov)
- Expiries are one moment for everyone; the dapp shows them in the user's local time by default (zone shown at the start
  of the expiry row, e.g. "UTC+3", and in tooltips with the UTC time). Settings → Times switches everything (expiry tabs,
  positions, history, breaker messages, charts) to UTC; the chart's zone button is a shortcut to the same setting.
- Option names (BTC-12NOV-74000-P), share links and the CSV export stay UTC so every user names an option the same way.
- Checked headless in Africa/Nairobi, America/Anchorage and UTC. Not checked in a browser: the UTC setting itself.

## Indexer
- Goldsky subgraph `piton-testnet`; the dapp queries the `prod` tag (…/piton-testnet/prod/gn). Code in `subgraph/`.
- After any redeploy: `npm run subgraph:deploy` (reads `deployments/matsnet.json`, moves `prod` once synced), then
  delete the old version (`goldsky subgraph list`, `goldsky subgraph delete piton-testnet/<version> --force`).
- After any contract change, sync both ABIs: `client/src/contracts/OptionPool.json` (full artifact) and
  `subgraph/abis/OptionPool.json` (ABI array only).
- Used for: trade history, 24h volume, History tab, realised P&L (incl. resales), APY (hourly share price), /stats.

## UI round (11 Nov, after live data)
- Done: account summary (replaces Market + Wallet), History tab from the subgraph with realised/unrealised P&L and
  CSV, portfolio greeks, expiry alerts + browser notifications, pool position/utilisation gauge/exposure, Settings,
  keyboard trading, dead code removed, tour updated, bundle split (landing page ~480 KB instead of 1.6 MB; charts load
  on demand), /stats page, read-only ?watch=0x… mode.
- Not verified by hand: keyboard trading and the expiry banner/notification (need a browser and a near-expiry ITM position).
- Deferred by the user: mobile layout. Blocked: MEZO options (no fresh MEZO oracle feed).

## Live data (11 Nov)
- One Multicall3 read per Mezo block (~4.2s) for oracle, pool stats and balances; pool event logs update options,
  trades and positions within a block; chain and trade-form quotes re-read every block; Binance miniTicker for the
  "last" price and 24h stats; polling slows to 30s and the ticker closes while the tab is hidden.
- Mezo's RPC caps one eth_call at ~1M gas: quotePremium (~83k gas) is batched 8 per request (see client/src/multicall.js).
- Visuals: flash on change, tick arrows, rolling totals, new trades slide in, "Chain #block · Ns ago" indicator.
- Store subscriptions use selectors (useShallow), so per-second ticks don't re-render the whole dashboard.

## VPS keeper
- pm2 `piton-ops` on `septem@173.249.33.115` (password login; `scripts/push-ops-vps.sh` asks once). Default jobs
  `iv,exercise,refund,poke,v1refund,oracle,savings`; it reads `deployments/matsnet.json`, so re-push after every redeploy.
- The retired V1 bot (`piton-bot`) is removed by the same push script. Bot wallets are empty.
- Logs: `ssh septem@173.249.33.115 'pm2 logs piton-ops'`. Keeper gas ~0.005 BTC; check weekly.

## Useful commands
```bash
npx hardhat test                                              # 180 tests
rm -rf cache-forge/invariant cache/invariant && forge test   # 17 tests
npm run test:client                                           # 83 tests
rm -rf client/dist && npm run build --prefix client && surge client/dist piton.surge.sh
npm run subgraph:deploy
SETUP=1 node scripts/demo.js && node scripts/demo.js          # demo take (PREFLIGHT=1 to check only)
cp artifacts/contracts/OptionPool.sol/OptionPool.json client/src/contracts/OptionPool.json   # after any contract change
```
Redeploy recipe (ask the user first): withdraw all pool shares and pause the old pool;
`KEEPER=0xdE33f1bC671f30686888C66bc077AD98dC3D7948 npx hardhat run scripts/deployV2.js --network matsnet`; owner
`setIV(0.39e18)` and `setMinPoolExpiry(900)`; `SEED=10000 npx hardhat run scripts/seedV2.js --network matsnet`; replace
addresses in client/src/network.mjs, README, WALKTHROUGH, CHECKPOINT, docs/OPERATIONS.md, scripts/lib/deployments.js,
scripts/demo.js; subgraph deploy; rebuild + surge; regenerate `docs/verify/`; the user re-pushes the keeper.

## Conventions agreed with the user
- One commit per change; never amend. Ask before redeploying. Merge to main locally; never push without permission.
- Never redeploy without recovering the pool funds first.
- Operational scripts, keys and VPS details stay out of git (`docs/`, `scripts/` are git-ignored). The deck is not in git.
- Ignore balances under 20 MUSD.
- Answers short and in plain language. Give explicit manual test steps with amounts. Be honest about what was and was not
  verified.
