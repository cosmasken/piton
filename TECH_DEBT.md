# Tech Debt — OptionPool.sol review

Reviewed `contracts/OptionPool.sol` (657 lines). Items 1–2 were confirmed by replicating the
contract arithmetic in Python. Trove findings (4–6) depend on Mezo's `BorrowerOperations`
behaviour and were not verified against its source. Tests, `yMUSD.sol` were not reviewed.

## Status (current)
All review findings and approved recommendations are implemented, except Stability Pool yield
(deferred for research). Details are under "Approved recommendations — progress" below; the
original findings are kept further down for reference.

Still open:
- DONE 10 Nov 2026: redeployed to matsnet — OptionPool `0x81BfAF401a4C500e2e2900DDd1af2Ba9c0179C9b`,
  yMUSD `0x3153f91886ab0CE5131a2D347F03a433F7FBf3b6` (`deployments/matsnet.json`). Verified on-chain: current
  bytecode, Mezo addresses, 300 s staleness, live price, quotes. Addresses updated in client, README, scripts.
  Still to do on matsnet: seed the pool, set IV to market (DVOL ~40%; default is 80%), and a manual
  Trove-margin + Protect-my-Trove test with a real testnet Trove. Old pools (`0x3737…`, `0x12f9…` holding
  12 MUSD of LP deposits) are retired; `scripts/recover.js` targets them.
- Browser click-through of the new UI (Trove margin signing, Protect my Trove, Sell into bids).
- Reviewer feedback — checked against the code on 2026-11-10:
  - ALREADY DONE: network-switch prompt. `Dashboard.jsx` shows "Switch to Mezo Matsnet" with a
    Switch Network button (wagmi `useSwitchChain`) instead of redirecting home.
  - ALREADY DONE: `/dashboard` refresh 404. `client` build copies `index.html` to `dist/200.html`
    (present in `client/dist`). Not re-checked on the live host.
  - ALREADY DONE: Pyth claim. BTC/USD is labelled Skip (Binance fallback); Pyth is only used, and
    labelled, for the "Mezo Ecosystem (Pyth)" multi-asset panel. README/home make no Pyth claim.
  - ALREADY DONE: "Mainnet-ready" claim. No occurrence left; home footer says "Unaudited — testnet only".
  - OPEN (decision): read Mezo's PriceFeed. Checked live on matsnet: Mezo's MUSD PriceFeed
    (`0x86bCF0841622a5dAC14A313a15f96A95421b9366`) wraps the same Skip oracle Piton already reads
    (`oracle()` = `0x7b7c…0015`, identical price) and adds a 60s max-age check. Mainnet PriceFeed:
    `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88`.
  - DONE: deck with a fee model — `deck/piton-deck.html` (11-slide investor deck, arrow keys; print to PDF) and
    `deck/piton-deck.pdf`. Fee model uses live BTC $74k / DVOL 39.7% on 10 Nov 2026.
  - OPEN (not checkable from the repo): video under 2:15.
- Stale user-facing copy (describes the old Trove design or old fill flow):
  - DONE: README fully rewritten (commit f888b0f). Remaining stale copy is only in the app:
  - (fixed) README "Trove Margin" section: says margin is drawn "only if the option is exercised", via
    `adjustTroveWithSignature`, "no capital lockup", and a "margin dropdown". Now: margin is borrowed
    from the Trove when the order is placed, via `withdrawMUSDWithSignature`; BTC stays in the Trove
    but the user carries the MUSD debt (+0.1% fee) until they repay.
  - README "Filling an order": pool fills at >= 95% of the *ask* (mid IV + 15%), and the buttons are
    now "Buy →" / "Sell →". It should also mention that bids can be sold into.
  - `client/src/home.jsx:160` and `client/src/tour.js:15`: "no capital lockup" Trove wording.
  - README has no section on Protect my Trove, the IV keeper, `KEEPER=` on deploy, or `npm run test:mezo`.
  (README.md and home.jsx have uncommitted local edits by the user, so they were not changed here.)
- Product ideas below (auto-exercise, European options, vaults, spreads, binaries, IV surface, perps;
  Trove plan options C and D).
- Contracts remain unaudited.

**Trove findings confirmed against Mezo's BorrowerOperationsSignatures source:** the signed digest
commits to exact collWithdrawal, debtChange, isDebtIncrease, borrower, recipient, a per-borrower
nonce and deadline — but NOT msg.sender. So (a) debtChange must be known at signing, which the
variable `profit` is not, so the current settle path cannot work as written; (b) anyone who sees the
stored sig can submit it, burning the nonce and stranding the MUSD in the pool.

## Critical

### 1. `_sqrt` is broken (lines 170-176) — Black-Scholes prices are wrong
For any input < 1e18 the initial guess `(x+1e18)/2` is already > `x`, so the loop never runs and
the function returns `x`, not √x. All expiries are < 1 year, so `sqrt(T)` returns `T`.

| Expiry | Contract √T | True √T |
|---|---|---|
| 15 min | 0.0000285 | 0.00534 |
| 1 day  | 0.0027    | 0.0523  |
| 14 days| 0.0384    | 0.1958  |

Effective vol is understated ~5x–190x. The pool sells options near intrinsic value, and the
95%-of-fair check in `_tryPoolFill` accepts nearly any premium. Existing tests (18/18) do not
assert price values.

**Fix:** correct the Babylonian sqrt (compute sqrt(x*1e18) with a proper initial guess) and add
tests comparing `bsPrice` to reference values.

### 2. `_ln` is less accurate than documented (lines 150-167)
Comment claims ~1e-7; truncated series gives ~1e-4 error when spot < strike
(ln(0.98): -0.020320 vs true -0.020203). For 15-min options d1 divides by ~0.004, so this
becomes a large price error.

**Fix:** add more series terms or narrow the range reduction (e.g. normalise around sqrt(2)).

### 3. Oracle staleness window is 2 hours (`PRICE_STALENESS = 7200`)
Min expiry is 15 minutes and the oracle updates every block. A stale price can open or settle
options.

**Fix:** reduce to ~60–300 seconds.

## High — Trove margin

### 4. Stored signature is replayable directly
`troveSig` is in a public struct. Anyone can call `adjustTroveWithSignature` on BorrowerOperations
with it: adds debt to the short's Trove, sends MUSD to the contract unaccounted, likely burns the
nonce so the option cannot settle (griefing).

### 5. Signature may not match settlement amount
EIP-712 signatures normally commit to exact params. `debtChange = profit` is unknown at signing
time. Verify against Mezo's BorrowerOperations; the feature may not work as designed.

### 6. No loss cap / no per-Trove accounting
- Trove path pays full `profit`; MUSD margin and pool paths cap at `o.collateral`.
- If the Trove falls below min ICR, `adjustTroveWithSignature` reverts: long cannot settle, short
  keeps the premium.
- Same Trove equity can back unlimited concurrent orders (nothing is locked).
- `troveDeadline` is not required to be >= `expiry`.

## Medium

- **No path to fill an open long order.** README says a manual short can take the other side, but
  only `fillLong` (fills short orders) exists. Unfilled long orders can only be cancelled.
- **Capped payouts not priced.** Call collateral = `2*spot - strike`, capping payout near 2x spot;
  BS prices uncapped options, so longs overpay.
- **Zero-collateral calls.** Strike >= 2x spot gives 0 collateral and 0 payout cap.
- **Performance fee can break withdrawals.** `_takePerformanceFee` checks only `fee <= totalAssets`,
  so `totalAssets` can fall below `lockedCollateral`, making `withdraw` revert on underflow.
- **Share dilution after total loss.** If `totalAssets == 0` with shares outstanding, new deposits
  mint 1:1, diluting old holders' claim on the new money.
- **Pool solvency vs real balance.** Open-order premiums and manual-short collateral share the
  contract balance with pool funds; pool accounting could pay out of other users' funds.
- **Fixed IV (80%), no skew/term structure.** Owner-settable 50–150% only.
- **`quotePremium` reverts if `expiry` is in the past** (unchecked subtraction).

## Other
- `scripts/deploy.js` was deleted but README and `package.json` still reference `deploy:testnet` /
  `deploy:mainnet`; verify these scripts work.
- Contracts are unaudited; testnet only.

## Suggested order
1. Fix `_sqrt` and `_ln`, add price-value tests.
2. Tighten oracle staleness.
3. Decide on Trove margin: fix replay/cap/locking or disable until verified.
4. Add a fill path for long orders (or update README).
5. Fix fee/withdraw underflow and zero-share dilution edge cases.

## Product ideas (ordered by effort)
1. Auto-exercise at expiry (keeper or permissionless settle).
2. European-style options (exercise only at expiry; safer oracle use).
3. Covered-call / cash-secured-put vaults.
4. Protective puts for Trove holders (MUSD cash-settled, sized to Trove debt).
5. Spreads/straddles (defined max loss, lower collateral).
6. Binary/digital options.
7. Utilisation-driven IV / IV surface.
8. Perps (largest build).

## Added during Trove work
- Client `fetchPrice` accepts an oracle price up to 90 minutes old, but the contract now rejects
  prices older than 300s. The UI can show a price that makes transactions revert with "stale price".
  Align the client threshold with `PRICE_STALENESS`.
- ~~"Protect my Trove" assumes MCR = 110% and `getTroveDebt` includes interest~~ — confirmed against
  Mezo's source and in `test/mezo.integration.test.js` (MCR = 1.1e18; `getTroveDebt` = principal +
  interest owed + accrued).
- ~~Exact amount delivered by `withdrawMUSDWithSignature`~~ — confirmed: recipient gets exactly the
  signed amount; Trove debt rises by amount × (1 + borrowingRate), borrowingRate = 0.1%. The 150%
  floor ignores the 0.1% fee (negligible). Matsnet governance could change the rate; not re-checked live.
- FIXED: front-running the Trove signature from the mempool used to strand MUSD in the pool
  (recipient was the pool). Recipient is now the seller; the pool pulls via transferFrom.
- Integration tests run Piton against Mezo's real MUSD contracts (mezo-org/musd @ da7888a) on the
  Hardhat network: `npm run fetch:mezo && npm run test:mezo`. Mezo sources are GPL-3.0 and gitignored;
  `PCV.sol` gets a local ReentrancyGuardUpgradeable shim because OZ-upgradeable 5.6 dropped it.
- Not covered by local tests: Skip oracle behaviour on matsnet, matsnet governance parameters, and
  the actual deployed BorrowerOperationsSignatures address/domain. A matsnet smoke test after
  redeploy is still required.

## Approved recommendations — progress
- DONE: share dilution after a total loss. Deposits revert while yMUSD is outstanding and
  `totalAssets == 0`; owner `clearWorthlessShares(holders)` burns the worthless shares (only when the
  pool holds nothing, and only if the list clears the whole supply). Holders can also withdraw 0.
  Note: with current logic `totalAssets` cannot naturally reach 0 (the pool always keeps the net
  premium), so this is a defensive guard; it is tested via `OptionPoolHarness`.
- DONE: call payout cap raised from 2x to 3x spot (`CALL_CAP_MULTIPLE = 3`); zero-collateral calls
  are now strikes >= 3x spot. Order form shows "Max payout" (and the BTC price where it is reached)
  for longs, and warns when a call can never pay out. Pricing still assumes an uncapped payoff; with
  a 3x cap and <= 14 day expiries the overpricing is negligible at 80% IV.
- DONE: IV safety margin + keeper. Pool fills and `quotePremium` use `askIv() = iv * (1 + ivSpreadBps)`,
  default spread 15% (owner-tunable, max 50%); `bsPrice` stays at mid IV. New `ivKeeper` role can call
  `setIV` and nothing else. `scripts/ivKeeper.js` reads Deribit BTC DVOL and pushes it hourly (cron),
  skipping changes < 2 vol points and stale data. IV floor lowered from 50% to 25%: live DVOL was
  ~39.7% when this was written, so a 50% floor would have kept the pool ~45% overpriced.
- DONE: order book shows bids (long orders the pool did not fill) next to asks; "Sell →" calls
  `fillShort` after approving the collateral (calls +2% buffer since the contract recomputes it from
  spot). Modal shows premium received (net of 2% fee), collateral locked and max loss. Built, not
  click-tested in a browser.
- DONE: client oracle staleness aligned with the contract (`PRICE_STALENESS_S = 300` in store.js, was
  90 min). While stale, the order button is disabled with a "retrying" label instead of letting
  users sign a transaction that reverts; the existing banner still shows the Binance fallback price.
- DONE: deploy scripts are tracked. `.gitignore` still ignores `scripts/*` (bot scripts hold keys) but
  re-includes the key-free `deployV2.js`, `seedV2.js`, `health.js`, `ivKeeper.js` and `scripts/lib/`.
  `deployV2.js` validates inputs before sending any tx, writes `deployments/<network>.json`, and
  optionally sets the IV keeper (`KEEPER=0x...`); seed/health/keeper read that file. `health.js` now
  checks oracle age against `PRICE_STALENESS` and shows mid/ask IV and the keeper. Verified end to end
  on a local Hardhat node (deploy → seed → health → keeper dry-run → keeper update).
  Still manual after a real redeploy: update `client/src/network.mjs` and the README table.
- DEFERRED (approved): Stability Pool yield for idle LP capital — research before building.

## Security review prep (audit/)
- DONE: static analysis with Slither 0.11.6 + Aderyn 0.6.8; findings fixed or triaged in
  `audit/STATIC_ANALYSIS.md` (incl. yMUSD pool re-settable by owner — fixed). `npm run analyze`.
- DONE: Foundry fuzz + stateful invariant tests (`npm run fuzz:setup && npm run fuzz`).
- DONE: `audit/THREAT_MODEL.md` for auditors.
- OPEN T-1 (medium, owner power): raising `performanceFeeBps` applies retroactively to all past net yield.
- OPEN O-2 (medium): no oracle price sanity/deviation bound.
- OPEN O-3/O-4: IV can be set to the 25% floor; TVL and per-option caps unbounded → multisig + timelock.

## Network selection (testnet / mainnet)
- DONE: user-selectable network (toggle in home nav and dashboard; remembered; `?network=` link).
  Single config in `client/src/network.mjs`. Mainnet uses zero-address placeholders for Piton's
  pool/yMUSD, so the dashboard shows a "not live on Mainnet" banner, locks trading panels and never
  calls the placeholders; prices still read Mezo's mainnet oracle. Faucet links only on testnet; the
  `/faucet` page is removed (unknown paths redirect home). Tests: `client/src/network.test.mjs`.

## Economic review (10 Nov 2026) — fixed
- E1 pool sold in-the-money options below exercise value (buy-and-exercise took value from LPs, incl. via the
  fee recipient): FIXED, immediate-exercise floor on fills and quotes.
- E2 LP shares ignored open-option liability: FIXED, shares priced on net asset value.
- E3 / T-1 retroactive performance fee: FIXED, high-water mark.
- Tests: `test/OptionPool.economics.test.js` (13, each mutation-checked) and Foundry invariant
  `invariant_flashExerciseNeverProfits` (found the exploit unaided when the fix was removed).
- T-2: FIXED in the second review (performance fee on recognised yield only).
- The contract is redeployed after these fixes; the previous matsnet pool `0x81Bf…9C9b` is retired.

- DONE 10 Nov 2026: redeployed after the economic review — OptionPool `0x7240a712402cd992881aE3b9dAA58955509ce582`,
  yMUSD `0x387A9D85541CE34082C2d9F0E618ac0a3D6A49DA`; seeded 2,500 MUSD, IV set to DVOL (40.5%). Verified live: an
  immediate-exercise round trip loses the buyer money and the pool gains it. `0x81Bf…9C9b` (briefly deployed earlier
  the same day, before the fixes) and older pools are retired.

## Second review (10 Nov 2026) — 12 pool-protection changes, one commit each
1 premium-lock NAV · 2 deposit lock + withdrawal fee · 3 utilisation/exposure limits · 4 minimum rent ·
5 strike band · 6 utilisation markup · 7 minimum pool expiry · 8 circuit breaker · 9 opt-in auto-exercise +
`scripts/autoExercise.js` · 10 Ownable2Step + guardian + `PitonTimelock` + `scripts/setupGovernance.js` ·
11 differential test vs Derive v1 · 12 adjustable open-option cap with measured gas.
- Details and rationale: `audit/THREAT_MODEL.md` section 7. Tests: `test/OptionPool.{premiumlock,exitprotect,limits,governance,derive}.test.js`
  and Foundry `invariant_navTimingNeverPays`. Each change was mutation-checked (removing it fails a test).
- NOT DONE as first specified: #12 asked for a snapshot liability cache for unlimited open options. It does not fit in
  the contract size limit (23,046 of 24,576 bytes used), so the cap is adjustable (default 50, ceiling 150) and its gas
  is tested. A cache would need the pricing maths moved into a linked library first.
- DONE: redeployed matsnet with these changes — OptionPool `0xe27c6a15D947757Ae7bcc945063C45C650B3F357`, yMUSD
  `0x00967781f41728A8d5BD64D2EeFd75e28F5f0246`; seeded 2,500 MUSD, IV from DVOL (40.32%), `minPoolExpiry` set to 900 s
  for quick testing (default 3600). `0x7240…` is retired and empty. OPEN: timelock and guardian not set up; no external audit.
