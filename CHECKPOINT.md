# Checkpoint (end of 10 Nov 2026)

Where the project stands, and what to pick up next. Read this first when resuming.

## State
- **Branch / last commit:** `main` @ `6e8b32b` ("Record new matsnet deployment"). Working tree clean.
- **Live deployment (Mezo testnet, chain 31611):**
  - OptionPool `0x21F83eEcF5561AB721ec4f8E96279EC1BFCb8221` (deploy block 16700608).
  - yMUSD `0x09Da1957c5E435894D4d11451e9a7b2C9C24500c`.
  - Seeded with 2,500 MUSD by the deployer `0x09aB…6D06`; IV 40%.
  - `minPoolExpiry` is 900 s on testnet (default 3600).
  - The IV keeper `0xdE33…7948` is authorised.
- **Site:** https://piton.surge.sh, pointing at the deployment above.
- **Older pools:** emptied. Balances under 20 MUSD are ignored by agreement.
- **Tests:** Hardhat 158, Foundry 16 (invariants and fuzz), client 33, all passing.
- **Contract size:** 24,411 of 24,576 bytes.

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

## Indexer
- Goldsky subgraph `piton-testnet`, versions 1.0.0 and 1.0.1; tag `prod` -> 1.0.1. Code in `subgraph/`.
- Verified on 11 Nov: pool totals, all 3 options, both trades, the sell-back payout and account totals match the chain.
- The dapp's trade history (Recent trades tab, 24h volume, last trade) uses it, with a chain-log fallback.
- After any redeploy run `npm run subgraph:deploy` (reads `deployments/matsnet.json`, which now stores `deployBlock`).
- Not yet used for: pool share-price/yield charts and per-user history (the data is indexed; UI not built). Delete the
  unused 1.0.0 version with `goldsky subgraph delete piton-testnet/1.0.0` when convenient.

## Waiting on the user
- **Manual testing:** run [WALKTHROUGH.md](WALKTHROUGH.md) and report back step by step.
- **Keeper is running on the VPS** (11 Nov 2026) under pm2 as `piton-ops`, jobs `iv,exercise,refund,poke` (no demo bot).
  - Verified on-chain: it refunded the expired test option #1 and poked the circuit breaker.
  - Login is `septem@173.249.33.115` with a password (no local SSH key is authorised); `scripts/push-ops-vps.sh` asks once.
  - Logs: `ssh septem@173.249.33.115 'pm2 logs piton-ops'`. Keeper gas: about 0.005 BTC; check it weekly.
  - Step 11 of the walkthrough (auto-exercise) can now be run.

## Next tasks, in suggested order
1. **Fix whatever the walkthrough finds.** (The per-option size pre-check is now done.)
2. **Chart rebuilt (11 Nov):** Lightweight Charts 5.3.0 (Apache-2.0; TradingView logo kept for attribution), live Binance
   candle, option overlays, expected-move cone, positions, OI, Trove and breaker lines, Volatility/Pool/Payoff tabs, UTC
   switch, full screen, shortcuts. Not verified with a wallet: position lines, click-to-select, Trove line.
3. **UI plan, remaining items** (done on 11 Nov: market header bar, size pre-check, chain columns, units, range,
   calls/puts view, open-interest bars, implied volatility, auto-scroll to the money; instrument detail strip with live
   countdown; order form with size in BTC or MUSD, price in MUSD or % of spot, 25/50/100% quick-fill, fills-now/rests banner):
   3. portfolio greeks totals and trade history from events (fill, exercise, sell-back, refund) with CSV export;
   4. pool page (utilisation gauge, exposure by strike/expiry, your share and P&L, APY only with enough history);
   5. mobile layout, keyboard shortcuts, loading states; fix the Pyth price box (Hermes returned "unauthorized").
   Later: MEZO options need a fresh MEZO oracle (on-chain Pyth on Mezo was ~117 days stale on mainnet and testnet);
   perps are a separate product, not planned.
4. **Demo bot on the VPS** (deferred by the user until the UI is settled).
   - `scripts/ops.js` exists: IV, exercise, refund, poke, demo bot.
   - Before using the demo bot, change it to use the standard expiry slots from `client/src/instruments.mjs`, so its orders
     do not create odd expiry tabs.
5. **Make room in the contract** before adding any more contract features: move `_bs`, `_cdf`, `_ln`, `_expNeg` and `_sqrt`
   into a linked library. This requires updating the deploy script and the test deployments (library linking).
6. **Oracle cross-check.**
   - First, an off-chain watchdog in `ops.js`: compare Skip with Deribit and an exchange; ask the guardian to pause if they
     differ by more than 2%.
   - Then on-chain Skip vs Pyth (`0x2880aB155794e7179c9eE2e38200202908C17B43`, BTC/USD feed
     `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`).
   - Blocker: the testnet Pyth BTC/USD feed was about 106 days stale. Ask the Mezo team to refresh it, and confirm how often
     it updates on mainnet.
7. **Open-option cap.** It is currently 50 by default, at most 150. To go higher:
   - pack storage (cheap), then
   - add a keeper-refreshed liability cache (needs step 3 first).
8. **Governance handover**, done last:
   - `DELAY_HOURS=0.1 npx hardhat run scripts/setupGovernance.js --network matsnet`, then execute `acceptOwnership` through
     the timelock.
   - After that, admin changes (keeper, `minPoolExpiry`) go through the timelock.
9. **Later:**
   - mobile layout
   - selling back options bought from another trader (needs transferable positions)
   - pool yield history charts (data now in the subgraph)
   - ask Block Scholes about a volatility feed on Mezo
   - external audit before any mainnet launch

## Useful commands
```bash
npx hardhat test                    # 158 tests
rm -rf cache-forge/invariant cache/invariant && forge test   # 16 tests
npm run test:client                 # 33 tests
npm run build --prefix client && surge client/dist piton.surge.sh
npm run health:testnet              # pool status
cp artifacts/contracts/OptionPool.sol/OptionPool.json client/src/contracts/OptionPool.json   # after any contract change
```

## Conventions agreed with the user
- One commit per change; never amend. Ask before redeploying.
- Never redeploy without recovering the pool funds first.
- Operational scripts, keys and VPS details stay out of git.
- Answers short and in plain language. Give explicit manual test steps with amounts. Be honest about what was and was not
  verified.
