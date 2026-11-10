# Piton threat model

For auditors and reviewers. Describes what the contracts protect, who can do what, what we trust,
and the risks we already know about. Last updated 10 Nov 2026, after the economic review in section 5.6 (E1–E3).

## 1. Scope

| In scope | Lines | Notes |
|---|---|---|
| `contracts/OptionPool.sol` | ~780 | Order book, liquidity pool, Black-Scholes pricing, settlement, Trove-funded margin |
| `contracts/yMUSD.sol` | ~40 | LP share token; only the pool can mint/burn |

Out of scope: the React client, deploy/ops scripts, the IV keeper's hosting, and Mezo's own
contracts (MUSD, TroveManager, BorrowerOperationsSignatures, Skip oracle), which are treated as trusted
dependencies (section 4).

Compiler: Solidity 0.8.28 (pinned), `viaIR`, optimizer 200 runs, `evmVersion: london`. No proxies,
no upgradeability, no `delegatecall`, no native-BTC handling: all value is MUSD (ERC-20).

## 2. What is at risk

| Asset | Where it sits | Who it belongs to |
|---|---|---|
| LP capital | `totalAssets` (MUSD in OptionPool) | yMUSD holders, pro rata |
| Locked collateral | `lockedCollateral` ⊆ `totalAssets` | Pool, backing open pool-sold options |
| Unfilled buyer premiums | MUSD in OptionPool, per open long order | The buyer, until filled or cancelled |
| Seller collateral (MUSD or Trove-funded) | MUSD in OptionPool, per short order | The seller, minus any payout to the buyer |
| Protocol fees | Sent to `feeRecipient` immediately | Protocol |
| Sellers' Mezo Troves | In Mezo, not in Piton | Seller; Piton can only draw what the seller signs for |

Core accounting identity (tested as a fuzz invariant):
`MUSD.balanceOf(pool) == totalAssets + Σ unfilled premiums + Σ non-pool collateral`, exactly.

## 3. Actors and their powers

### Anyone
`deposit`, `withdraw` (own shares), `createLongOrder`, `createShortOrder`, `createShortOrderTrove`
(own Trove), `fillLong`, `fillShort`, `settle` (only the option's long), `refund` (any expired, filled
option; funds go to the rightful party), `cancelOrder` (own unfilled order).

### Owner (OptionPool)
The owner cannot move user or pool funds directly. There is no admin withdraw, no upgrade, and no way
to repoint the oracle, MUSD, yMUSD or Mezo addresses (all `immutable`).

| Power | Bound | Worst case if abused or compromised |
|---|---|---|
| `setIV` | 25%–150% | **Underprice options:** set IV to 25% and buy cheap options from the pool with a friendly wallet. Bounded per option by `maxOptionCollateral` and in total by free liquidity. **The main owner/keeper risk.** |
| `setIvSpreadBps` | ≤ 50% | Set to 0 to remove the LP safety margin (same direction as above, smaller effect). |
| `setTVLCap`, `setMaxOptionCollateral` | Unbounded | Raise exposure limits. Increases potential loss, does not transfer funds. |
| `setProtocolFeeBps` | ≤ 5% | Applies to future fills only. |
| `setPerformanceFeeBps` | ≤ 30% | Fee accrued so far is charged at the old rate first, and a high-water mark means a change is never applied to past yield (fixed; was T-1). |
| `setFeeRecipient` | Non-zero | Redirects future fees. |
| `setIvKeeper` | Any address (0 disables) | Grants `setIV` to another key. |
| `pausePool` / `unpausePool` | — | Blocks new deposits, orders and fills. **Cannot block exits:** `withdraw`, `settle`, `refund`, `cancelOrder` are not pausable (tested). |
| `clearWorthlessShares` | Only when `totalAssets == 0 && lockedCollateral == 0` | Burns yMUSD that is worth nothing; cannot touch value. Unreachable in practice: the pool always keeps the net premium. |
| `transferOwnership` / `renounceOwnership` (OpenZeppelin) | — | Renouncing freezes IV and limits at their last values. |

### Owner (yMUSD)
`setPool` once. After that the owner has no remaining power over yMUSD (fixed in `30aca41`; before,
a re-settable pool allowed minting unlimited shares).

### IV keeper
Can call `setIV` within 25%–150% and nothing else (tested). `scripts/ivKeeper.js` reads Deribit's BTC
DVOL hourly, skips changes under 2 vol points and refuses data older than 3 hours. A compromised
keeper key has the same `setIV` risk as the owner, but no other power.

### Recommended operational controls (not enforced on-chain)
- Owner = multisig (e.g. Safe 2-of-3) with a timelock on parameter changes.
- Keeper = dedicated hot key, separate from the owner, with alerting on every `IVUpdated`.
- Monitor all admin events (every setter emits one) and `utilisation()`.

## 4. Trust assumptions

| Dependency | Assumed | If wrong |
|---|---|---|
| **Skip oracle** `0x7b7c…0015` (BTC/USD, Mezo validators, every block) | Honest and live. Piton rejects prices ≤ 0 or older than 300 s. | A wrong price lets longs settle ITM options at the wrong value. Loss per option is capped at its collateral, but many options could be drained in one block. No deviation/sanity bound yet (open item O-2). |
| **MUSD** | Standard ERC-20: no fee-on-transfer, no rebasing, no transfer hooks, no blocklist. | Fee-on-transfer would break the exact accounting; a blocklist could block a specific user's payout (their `settle` reverts). |
| **Mezo `BorrowerOperationsSignatures`** | Verifies the EIP-712 WithdrawMUSD signature, consumes the nonce, mints exactly `amount` to `recipient`. | Integration-tested against Mezo's real contracts (`test/mezo.integration.test.js`). |
| **Mezo `TroveManager`** | Reports correct coll/debt for the 150% post-draw check. | Only affects whether a Trove-funded order is accepted; the margin itself is real MUSD in the pool. |
| **Deribit DVOL** (off-chain, keeper only) | Reasonable BTC IV. | Bounded by the on-chain 25%–150% range. |

## 5. Threats and mitigations

### 5.1 Pool accounting / solvency
- **Paying out more than held.** Every payout is `min(profit, collateral)`; pool collateral is
  reserved in `lockedCollateral` before a fill and `totalAssets ≥ lockedCollateral` is enforced.
  Fuzz invariants: exact balance identity, locked collateral matches open pool options, payout ≤
  collateral, withdraw ≤ pro-rata share.
- **First-depositor share inflation.** First deposit must be ≥ 0.001 MUSD; shares are computed
  from internal `totalAssets` (not `balanceOf`), so donations cannot move the share price.
- **Dilution after a total loss.** Deposits revert while yMUSD exists with zero assets.
- **Performance fee draining locked collateral.** The fee is capped at free liquidity.
- **Reentrancy.** All state-changing functions are `nonReentrant`; checks-effects-interactions
  applied in `deposit`, `withdraw`, `createShortOrderTrove`. External calls go only to MUSD, yMUSD and Mezo.

### 5.2 Pricing (LPs are short volatility)
- **Mispricing by the on-chain model.** `_ln`, `_sqrt`, `_cdf`, `_expNeg` are fixed-point. Tests
  check Black-Scholes within 1% of a reference across 8 cases; fuzzing checks no-arbitrage bounds,
  put-call parity (±0.01% of spot), and monotonicity in spot and time (1,000 runs each).
- **Stale IV.** The keeper updates at most hourly and only on ≥ 2-point moves. Traders who see DVOL
  jump first can buy before the update. Mitigated by the 15% IV margin; residual LP risk.
- **No skew / term structure.** One IV for all strikes and expiries; deep OTM puts are usually
  underpriced by flat-vol Black-Scholes. Residual LP risk.
- **Oracle latency.** The on-chain spot can trail centralised exchanges within a block. Short
  (15-minute) options are most exposed. Residual LP risk, bounded by per-option collateral.
- **Payout cap not priced.** Calls pay at most (3 × spot − strike) × qty, but are priced as
  uncapped. With ≤ 14-day expiries a 3× move is negligible probability, so buyers overpay a tiny amount.

### 5.3 Trove-funded margin
- **Replay.** The Mezo signature is consumed (nonce) in the same transaction; nothing is stored.
- **Front-running the signature.** The signed recipient is the seller, so a front-runner only sends
  the borrowed MUSD to the seller's own wallet; the seller's order then fails cleanly (tested
  against Mezo's contracts).
- **Wrong amount or recipient.** Mezo rejects any signature that doesn't match the exact
  `marginAmount` and recipient; the pool also checks the seller received ≥ `marginAmount`.
- **Trove later becomes unhealthy.** Irrelevant to the option: the margin is already MUSD in the pool.
  The 150% floor protects the seller from being pushed straight toward liquidation by the draw.

### 5.4 Lifecycle edge cases
- `settle` requires `expiry > now`, `refund` requires `now ≥ expiry`: no overlap, no gap.
- **In-the-money options not settled before expiry are lost to the long** (American exercise, no
  auto-exercise). User risk by design; auto-exercise is on the roadmap.
- `refund` is permissionless but only moves funds to the rightful party.
- Cancelled or settled orders can't be filled again (status checks; covered by the fuzz handler).

### 5.5 Denial of service / griefing
- `userOptions[user]` arrays grow without bound but are only read by views.
- `clearWorthlessShares` loops over a caller-supplied list; split it if it hits the gas limit.
- Spam orders cost the spammer premium or collateral and don't affect the pool.

## 5.6 Economic review (10 Nov 2026)

A focused review of every path that moves value found three issues. All are fixed and covered by tests that fail if the fix is removed (`test/OptionPool.economics.test.js`, plus a Foundry invariant):

| ID | Issue | Fix |
|---|---|---|
| E1 (high) | The pool filled orders at ≥ 95% of its price. For in-the-money options that price is close to immediate-exercise value, so a buyer could buy and exercise at once for a profit at LPs' expense (also usable by the fee recipient). The pricing model ignores early exercise, so deep in-the-money puts were also slightly under-priced. | The pool never fills below immediate-exercise value grossed up for the 2% fee. Quotes include the same floor. |
| E2 (medium) | LP shares were priced on raw assets, ignoring what open options would pay if exercised now. An LP could withdraw before a known loss and leave it to others; a new depositor could buy in at an inflated price. | Shares are priced on net asset value (assets minus the immediate-exercise liability of open pool options, capped at their collateral). Open pool options are capped at 50; a stale oracle assumes the full collateral is owed. |
| E3 (medium) | Retroactive performance fee (T-1). | High-water mark; accrued fee charged at the old rate before a change. |

Accepted: a seller's resting ask can go stale as the price moves (normal order-book risk; they can cancel). Beyond 50 open pool options, new buys rest as bids until options expire (cost: ~0.7M gas worst case per deposit or withdrawal).

## 6. Known open findings

| ID | Severity (our view) | Finding | Suggested fix |
|---|---|---|---|
| T-1 | ~~Medium~~ **Fixed** | Raising `performanceFeeBps` was retroactive. Now the accrued fee is charged at the old rate inside the setter, and fees apply only above a high-water mark. | — |
| T-2 | Low | The performance fee is charged on premium when it is booked (at fill), before the option expires. If that option later pays out, the fee is not returned (no clawback). The fee recipient can also buy from the pool at a small effective discount funded by this. | Charge only on realised yield (track each option's net premium until it settles or expires). |
| O-2 | Medium | No price sanity bound (e.g. max per-block deviation or min/max price) on the Skip oracle, which Mezo's own docs recommend. | Add bounds and/or read Mezo's PriceFeed; pause on large deviations. |
| O-3 | Low–Medium | Owner/keeper can set IV to the 25% floor and buy underpriced options. | Multisig + timelock owner; rate-limit IV changes per hour on-chain. |
| O-4 | Low | `setTVLCap` / `setMaxOptionCollateral` are unbounded. | Timelock, or hard upper bounds. |
| O-5 | Info | ITM options not settled by expiry are forfeited. | Keeper-driven auto-exercise. |

## 7. Verification already done

| What | Where | Result |
|---|---|---|
| Unit + edge-case tests (Hardhat) | `test/OptionPool.test.js`, `test/OptionPool.edge.test.js`, `test/ivKeeper.test.js` | 73 passing |
| Integration against Mezo's real MUSD / Trove / signature contracts | `test/mezo.integration.test.js` (`npm run fetch:mezo && npm run test:mezo`) | 11 passing |
| Stateful invariant fuzzing (Foundry) | `test/foundry/OptionPool.invariant.t.sol` (`npm run fuzz`) | 7 invariants × 256 runs × 60 calls; coverage test proves every action path succeeds; mutation-checked (2 planted accounting bugs caught) |
| Pricing property fuzzing | same file | 4 properties × 1,000 runs |
| Static analysis | Slither 0.11.6, Aderyn 0.6.8 (`npm run analyze`) | All results fixed or triaged: `audit/STATIC_ANALYSIS.md` |

## 8. Questions we'd like auditors to focus on

1. Can the exact accounting identity in section 2 be broken by any sequence of calls or rounding?
2. Precision and overflow of the fixed-point maths at extreme inputs (very short expiries, deep
   ITM/OTM, IV at 25% and 150%).
3. The Trove-margin flow: any way to make the pool record collateral it didn't receive, or to draw
   from someone else's Trove?
4. Economic attacks on the pool through oracle latency, IV staleness, or the 95%-of-ask fill rule.
5. Anything the owner or keeper can do beyond the table in section 3.
