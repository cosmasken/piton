# Tech Debt — OptionPool.sol review

Reviewed `contracts/OptionPool.sol` (657 lines). Items 1–2 were confirmed by replicating the
contract arithmetic in Python. Trove findings (4–6) depend on Mezo's `BorrowerOperations`
behaviour and were not verified against its source. Tests, `yMUSD.sol` were not reviewed.

## Status
Fixed (commit c153b70 + follow-up): #1, #2, #3, Trove payout cap + deadline>=expiry, performance-fee/
withdraw underflow, `quotePremium` past-expiry revert, `fillShort` added (open long orders can now be
filled by a manual seller), zero-collateral calls rejected/not pool-filled, `Settled` event now emits
the amount actually paid. Pool solvency vs balance: no bug found; covered by an invariant test.

Trove margin (#4/#5/#6): FIXED by redesign — margin is drawn from the Trove at order creation with a
signature consumed in the same tx (nothing stored, no replay, no settle-time Mezo call). See
TROVE_PLAN.md option A. Still to verify on matsnet: exact amount delivered by
`withdrawMUSDWithSignature` (fees/interest).

Open, needs a decision: zero-share dilution policy,
capped-payout pricing, fixed IV. UI button for `fillShort` not built.

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
