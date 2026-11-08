# SPEC: Mezo Trove / Stability Pool as Option Margin

## Problem

Today every short position must post liquid BTC or MUSD as collateral.
A user who already has capital locked in a Mezo Trove (borrowing MUSD against
BTC) or deposited in the Stability Pool must either unwind that position or
hold duplicate capital to write options. This raises the cost of capital and
limits liquidity.

## Goal

Let a short option seller pledge their Trove or Stability Pool position as
margin instead of posting fresh BTC/MUSD, without moving the underlying
collateral out of those positions.

---

## Background: Mezo primitives

| Primitive | What it holds | Relevant interface |
|---|---|---|
| Trove | BTC collateral, MUSD debt | `ITroveManager`, `IBorrowerOperations` |
| Stability Pool | MUSD deposits earning BTC liquidation gains | `IStabilityPool` |

Both are standard Liquity-fork contracts. Key read methods:
- `TroveManager.getTroveColl(address)` → BTC collateral (wei)
- `TroveManager.getTroveDebt(address)` → MUSD debt (18 dec)
- `StabilityPool.getCompoundedMUSDDeposit(address)` → MUSD deposit (18 dec)

---

## Design

### Margin types (extend existing `settlementType` enum)

| Value | Name | Collateral source |
|---|---|---|
| 0 | BTC | msg.value (existing) |
| 1 | MUSD | transferFrom (existing) |
| 2 | TROVE | Trove net equity read-only lien |
| 3 | STABILITY | Stability Pool deposit read-only lien |

Types 2 and 3 are **lien-based**: no tokens move at order creation. The
contract reads the position value at fill time and at settlement/expiry to
verify coverage. If the position falls below the required margin the option
becomes liquidatable (see below).

### New contract: `UsingMezoPositions`

```solidity
interface ITroveManager {
    function getTroveColl(address owner) external view returns (uint256);
    function getTroveDebt(address owner) external view returns (uint256);
    function getTroveStatus(address owner) external view returns (uint256);
}

interface IStabilityPool {
    function getCompoundedMUSDDeposit(address depositor) external view returns (uint256);
}

contract UsingMezoPositions {
    ITroveManager   public immutable troveManager;
    IStabilityPool  public immutable stabilityPool;

    // Returns net BTC equity of a Trove scaled to 10^18 MUSD using oracle price.
    function troveEquityMUSD(address owner) public view returns (uint256);

    // Returns MUSD value of a Stability Pool deposit.
    function spDepositMUSD(address owner) public view returns (uint256);

    // Returns true if the position still covers requiredMargin.
    function positionCoversMargin(
        uint256 marginType,   // 2 = trove, 3 = stability
        address owner,
        uint256 requiredMargin
    ) public view returns (bool);
}
```

### Changes to `CallOption` / `PutOption`

**`createNewOptionShort` / `sellToOpen`** (type 2 or 3):
1. Call `positionCoversMargin(type, msg.sender, requiredMargin)` — revert if not covered.
2. Store `marginType`, `marginOwner = msg.sender`, `requiredMargin` in the Option struct.
3. No token transfer.

**`settleOption`** (type 2 or 3):
1. Re-check `positionCoversMargin` at settlement time.
2. If covered: call `IBorrowerOperations.withdrawMUSD` (trove) or
   `IStabilityPool.withdrawFromSP` (stability) to pull exactly `payout` MUSD
   from the short's position into the contract, then transfer to long.
3. If not covered: revert with `"Margin position insufficient"` — liquidation
   path handles this (see below).

**`refundExpired`** (type 2 or 3):
- No token to return to short. Just mark settled.

### Liquidation path (new)

If `positionCoversMargin` returns false before expiry, anyone can call:

```solidity
function liquidateMargin(uint256 _id) external;
```

This:
1. Verifies the position no longer covers required margin.
2. Pulls whatever MUSD is available from the position (up to `requiredMargin`).
3. Pays the long their pro-rata share; marks the option settled.
4. Pays the caller a 1% liquidation bonus from the recovered amount.

### Required margin formula (unchanged for types 2/3)

- Call short (type 2 trove): `troveEquityMUSD(owner) >= 2/3 * marketVal * qty`
- Call short (type 3 stability): `spDepositMUSD(owner) >= 2/3 * marketVal * qty`
- Put short (type 2/3): not applicable — put shorts already require full strike
  in MUSD; trove equity can cover this if `troveEquityMUSD >= strikePrice * qty`

---

## Open questions (need answers before implementation)

1. **Mezo contract addresses** — `ITroveManager` and `IStabilityPool` addresses
   on matsnet and mainnet are not yet in the public docs. Need to confirm.

2. **`withdrawMUSD` / `withdrawFromSP` authorization** — does the option
   contract need to be whitelisted by the Trove/SP contracts to pull funds, or
   can any contract call these on behalf of a user who has pre-approved it?
   If whitelisting is required, deployment order matters.

3. **Trove health during option lifetime** — a Trove can be liquidated by the
   Mezo protocol independently. Should the option contract monitor this, or is
   the `liquidateMargin` path sufficient?

4. **Stability Pool compounding** — SP deposits earn BTC gains and MUSD burns
   over time. The deposit value can decrease. Is a 10% overcollateralisation
   buffer on top of the 2/3 margin requirement acceptable?

5. **UI flow** — when a user selects "Trove" or "Stability Pool" as margin
   type, the frontend should display their current position value and the
   required margin side-by-side. Confirm this is the desired UX.

---

## Affected files

| File | Change |
|---|---|
| `contracts/UsingMezoPositions.sol` | New |
| `contracts/CallOption.sol` | Add types 2/3 to `createNewOptionShort`, `sellToOpen`, `settleOption`, `refundExpired`; add `liquidateMargin` |
| `contracts/PutOption.sol` | Same as above |
| `contracts/test/MockTroveManager.sol` | New mock |
| `contracts/test/MockStabilityPool.sol` | New mock |
| `test/mezoMargin.test.js` | New test file |
| `client/src/components/NewOrder.js` | Add margin type options 2/3; show position value |
| `client/src/components/OpenOrders.js` | Show margin type in order rows |
| `scripts/deploy.js` | Pass troveManager + stabilityPool addresses |

---

## Out of scope for this feature

- Accepting a Trove as collateral for BTC-settled calls (type 0) — the option
  contract needs to deliver actual BTC at settlement, which a Trove cannot
  provide directly.
- Cross-user margin (using someone else's Trove) — not supported.
