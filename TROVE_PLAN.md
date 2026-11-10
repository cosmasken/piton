# Trove Integration Plan

Goal: keep Mezo Trove as a core Piton feature (it is the differentiator and answers the
"tie the options to Mezo itself" feedback) without the flaws in the current stored-signature design.

## Why the current design cannot work

Based on Mezo's `BorrowerOperationsSignatures.sol` (mezo-org/musd):

- The signed digest commits to exact `collWithdrawal`, `debtChange`, `isDebtIncrease`, `borrower`,
  `recipient`, a per-borrower nonce and a deadline. The payout (`profit`) is unknown at signing time,
  so the settle-time pull in `OptionPool.settle` cannot match the signature on a real chain.
  The mock in the tests hides this.
- The digest does NOT bind `msg.sender`. Anyone who reads the stored `troveSig` can submit it,
  burning the nonce and stranding the MUSD in the pool. The long then cannot be paid.
- Troves are tied to the borrower address and are not transferable. Stability Pool positions cannot
  be used as margin either.

Status: Option A is implemented (contract, tests, client signing flow) and verified against Mezo's
real MUSD contracts on the Hardhat network (`npm run fetch:mezo && npm run test:mezo`). Redeploy is
still required for it to take effect on matsnet.

Design change found during integration testing: the WithdrawMUSD recipient is the seller (not the
pool), and the pool pulls the margin with transferFrom. Otherwise anyone could copy the signature
from the mempool, submit it directly to Mezo, and strand the seller's borrowed MUSD in the pool.
The client now signs with recipient = the user's wallet and approves the pool for the margin.

## Option A — Trove-funded margin at order creation (IMPLEMENTED)

The short signs a one-time typed message for an exact margin amount. `createShortOrderTrove`
submits it in the same transaction and draws that MUSD from the Trove into the pool as ordinary MUSD
collateral. From then on it follows the existing, tested MUSD-margin path.

- No stored signature, no replay window (the signature is consumed immediately).
- No dependency on Mezo at settlement time.
- BTC stays in the Trove; the user takes MUSD debt for the margin and pays Mezo interest.

Contract changes:
1. `createShortOrderTrove(..., uint256 marginAmount, bytes sig, uint256 deadline)`:
   - `marginAmount >= _requiredCollateral(...)` and `<= maxOptionCollateral`; the signed amount is
     exactly `marginAmount` (the contract no longer computes the draw from spot at tx time).
   - Call `withdrawMUSDWithSignature(marginAmount, hints, msg.sender, address(this), sig, deadline)`
     (or `adjustTroveWithSignature` with `isDebtIncrease = true`).
   - Verify MUSD received (balance delta) equals the expected amount.
   - Pre-check post-draw ICR: `collVal * 1e18 / (debt + marginAmount) >= MIN_ICR (150%)`.
2. Remove `troveSig` / `troveDeadline` from the `Option` struct (nothing stored).
3. Remove the Trove branch from `settle` and `refund`; margin type TROVE becomes metadata only
   (all payouts and refunds go through the MUSD path).
4. Refund returns unused margin as MUSD to the short; UI prompts them to repay their Trove.

Client changes:
- Typed-data signing flow (domain `BorrowerOperationsSignatures`, version `1`, nonce from `getNonce`).
- Margin amount input with required-collateral hint; ICR preview; "repay Trove" prompt after refund.

Tests:
- Replace the `MockBorrowerOps` pull-at-settle test with a draw-at-creation test.
- ICR too low after draw reverts; margin below required reverts; received-amount mismatch reverts.
- Existing settle/refund tests run against a Trove-margin order.

Open item to verify on matsnet before trusting: exact amount delivered by `withdrawMUSDWithSignature`
(borrowing fee / interest handling) and the `properRecipient` restriction.

Estimate: ~1 day including tests and UI.

## Option B — "Protect my Trove" (read-only; IMPLEMENTED)

Trove holders hedge liquidation risk with a put.

- UI reads `getTroveColl` / `getTroveDebt` via TroveManager.
- Liquidation price ≈ `debt * 110% / coll` (confirm Mezo's MCR on matsnet).
- Suggest a put at or above that strike, quantity = Trove collateral, expiry chosen by the user.
- Submit through the existing `createLongOrder`; the payout helps repay debt if BTC falls.

Implemented in `client/src/components/ProtectTrove.jsx` (sizing logic and tests in
`client/src/troveProtect.mjs`, run with `npm run test:client`). It appears above the order form on
the Long side; "Fill order form" prefills a put and prices it at fair value +2%.
Strike defaults to 15% above the liquidation price; coverage slider 10–100%; size is clamped to the
pool's per-option collateral cap. Assumes Mezo MCR = 110% (confirm on matsnet).

No contract changes. Strongest Mezo-specific demand story: every Trove holder is a potential buyer.

## Option C — Per-user Trove vault (later, needs audit-level care)

A vault contract is the Trove borrower; the pool controls withdrawals while options are open and can
draw debt at settlement without any signature. Most capital-efficient (debt only if exercised), but
needs native BTC handling, a factory, and ICR enforcement. Do only after A and B are live.

## Option D — Idle LP capital in the Stability Pool (research first)

Unlocked pool MUSD could earn Mezo yield. Not verified: the Stability Pool interface, and how BTC
gains and withdrawals behave. Research before committing.

## Related feedback status

- `PutOption.sol:184` / `CallOption.sol:210-213` High findings: V1 contracts, deleted in `2f5dcfc`.
  V2 pays MUSD via ERC-20 transfers and caps profit at collateral.
- Read MUSD's PriceFeed with a staleness check: Skip oracle in use, staleness now 300s; PriceFeed
  integration still open.
- Remaining non-code items: network-switch prompt, `200.html` (present in `client/dist`, verify
  `/dashboard` refresh), correct the Pyth and "Mainnet-ready" wording in client and README, deck with
  fee model, video under 2:15.

## Suggested order

1. Option A (contract + tests + client signing flow).
2. Option B (UI only).
3. Disable or clearly label Trove margin in the UI until A ships.
4. Remaining feedback items, then redeploy to matsnet and update README addresses.
5. Options C and D as follow-ups.
