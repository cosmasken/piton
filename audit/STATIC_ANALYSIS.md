# Static analysis — Slither 0.11.6 and Aderyn 0.6.8

Scope: `contracts/OptionPool.sol`, `contracts/yMUSD.sol`. Mezo's contracts and test mocks are excluded.
Reproduce with `./tools/static-analysis.sh` (raw reports go to `audit/out/`, gitignored).

Date: 10 Nov 2026. First run: Slither 63 results, Aderyn 1 high + 9 low categories.
After fixes: Slither 55 results, Aderyn 1 high + 5 low categories, all triaged below. Re-run after the
economic fixes (E1–E3): identical Slither results, nothing new; Aderyn's `nonReentrant`-ordering point was fixed.
The test suite (97 Hardhat incl. Mezo integration, 14 Foundry) passes after the changes.

Re-run after the 12 pool-protection changes (second review): Slither 55 results, the same categories and counts as above, nothing new. Aderyn adds one item, H-2 "unsafe casting" (`uint128(netPremium)`, `uint64(block.timestamp)` in `_addOpenPoolOption`): accepted, because `_tryPoolFill` returns early if the premium exceeds `type(uint128).max` and a timestamp cannot exceed `uint64`. The suite is now 141 Hardhat and 15 Foundry tests.

## Fixed

| Finding | Tool | Change |
|---|---|---|
| **yMUSD pool re-settable by the owner.** Not reported directly by either tool; found while triaging Aderyn's "centralization risk" and Slither's `events-access` on `yMUSD.setPool`. The owner could point `pool` at their own wallet, mint unlimited yMUSD, switch back, and withdraw LPs' MUSD. | manual (prompted by both) | `setPool` is now one-time (`pool already set`), emits `PoolSet`. Test added. |
| State written after external calls (`deposit`, `withdraw`, `createShortOrderTrove`) | Slither `reentrancy-no-eth`, `reentrancy-benign`; Aderyn H-1 | Effects moved before interactions. All three were already `nonReentrant` and only call MUSD / yMUSD / Mezo, so no exploit path existed; this removes the reliance on the guard. |
| Trove ICR check divided before multiplying | Slither `divide-before-multiply` | Compares `coll × spot ≥ newDebt × MIN_ICR` directly (both 1e36-scaled), no rounding. |
| Oracle / TroveManager / BorrowerOps addresses mutable storage | Slither `immutable-states`; Aderyn L-7 | `immutable` (no setter ever existed; now enforced by the compiler). |
| No zero-address checks in the constructor | Aderyn L-6 | Constructor rejects zero for all five addresses. Test added. |
| Admin setters and pause emit no events | Slither `events-access`; Aderyn L-5 | Events for every setter, pause/unpause and `cancelOrder`; address params indexed. Test asserts each one. |
| Uninitialised local `burned` | Slither `uninitialized-local` | Initialised explicitly (it was already 0; readability). |
| Floating pragma | Aderyn L-8 | Pinned to `0.8.28`. |
| `PUSH0` opcode | Aderyn L-4 | Resolved by the pinned pragma + `evmVersion: london` in `hardhat.config.js` (no PUSH0 emitted). |

## Accepted (not a vulnerability here)

| Finding | Tool | Why it is acceptable |
|---|---|---|
| `reentrancy-balance` in `createShortOrderTrove` (High/Medium) | Slither | The balance check around Mezo's `withdrawMUSDWithSignature` only confirms Mezo minted the margin. The pool then pulls exactly `marginAmount` with `transferFrom`, so even a wrong balance cannot give the pool less than the margin. The function is `nonReentrant`, MUSD has no transfer hooks, and Mezo's contract is trusted. Covered by `test/mezo.integration.test.js` against Mezo's real contracts. |
| Remaining Aderyn H-1 "state change after external call" | Aderyn | The remaining hits are *view* calls before state writes (`ymusd.totalSupply()`, `TroveManager.getTrove*`). These cannot re-enter. |
| `divide-before-multiply` (20) | Slither | Fixed-point maths in `_ln`, `_cdf`, `_expNeg`, `_bs` and the 95% fill threshold. Each step rescales by 1e18; precision is verified by the Black-Scholes accuracy tests (within 1% of a reference model across 8 cases). |
| `incorrect-equality` (2) | Slither | `timeToExpiry == 0` and `x == 0` early returns on exact integers; intended. |
| `timestamp` (14) | Slither | Expiry and oracle-staleness checks must use `block.timestamp`. Minute-level validator drift is irrelevant at 15-minute minimum expiries and a 300 s staleness limit. |
| `unused-return` on `latestRoundData` | Slither | Only `answer` and `updatedAt` are needed; the price is checked `> 0` and fresher than 300 s. Skip's `roundId`/`answeredInRound` carry no extra safety information for a per-block feed. |
| `missing-zero-check` on `setIvKeeper` | Slither; Aderyn L-4 | Deliberate: `address(0)` disables the keeper. Documented in a NatSpec comment. |
| `calls-loop`, `reentrancy-events` in `clearWorthlessShares` | Slither | Owner-only, only callable when the pool holds no assets, calls only the pool's own yMUSD. A huge holder list could hit the gas limit; the owner can split it across calls. |
| Centralization risk | Aderyn L-1 | Real but bounded; see the owner-powers section of `audit/THREAT_MODEL.md`. |
| Large literal / literal-instead-of-constant | Aderyn L-2, L-3 | Abramowitz–Stegun and series coefficients in the maths helpers. Naming each would hurt readability. |
| Public function not used internally | Aderyn L-5 | `bsPrice`, `askIv`, `availableLiquidity`, `utilisation` are read by the dapp and scripts. |
| `naming-convention` (13) | Slither | Style only (`_param` names, `SKIP_ORACLE` caps, `yMUSD` contract name). |
