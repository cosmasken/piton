# SPEC: Piton V2 — Unified Options Pool

## Overview

A single smart contract that is simultaneously the options engine and the liquidity pool. Users buy options, the pool automatically takes the short side. Depositors earn yield from premiums. Protocol earns fees on every trade.

---

## Design Principles

- One contract, no cross-contract calls for core flow
- Cash-settled only — everything in MUSD, no physical BTC movement
- Pool is always the short counterparty for long orders
- Manual short orders still supported (peer-to-peer alongside pool)
- Fully collateralised at all times

---

## Contracts

### `OptionPool.sol` — core contract

Handles:
- MUSD deposits / LP token issuance
- Option order creation (long and short)
- Automatic pool fill on long orders
- Manual fill for short orders
- Settlement
- Expiry refunds
- Fee collection

### `yMUSD.sol` — LP token

Standard ERC20. Minted on deposit, burned on withdrawal. Transferable.

---

## Option Model

- **Types**: Call, Put
- **Style**: American (exercise any time before expiry)
- **Settlement**: Cash only — MUSD profit paid to long, no BTC transfer
- **Expiry**: 15 minutes to 14 days, set at order creation
- **Sides**: Long (buyer) or Short (seller)

### Option struct

```solidity
struct Option {
    bool        active;         // false once settled or expired+refunded
    bool        settled;
    OptionType  optionType;     // CALL | PUT
    address     long;           // buyer
    address     short;          // seller (pool address or human)
    bool        filledByPool;   // true if pool is short counterparty
    uint256     strike;         // 18 decimals, MUSD per BTC
    uint256     premium;        // 18 decimals MUSD, paid by long at fill
    uint256     quantity;       // 18 decimals, BTC amount
    uint256     expiry;         // unix timestamp
    uint256     collateral;     // MUSD locked (pool or human short)
    uint256     id;
}
```

---

## Pool Capital

### Primary: MUSD deposits
- Anyone deposits MUSD → receives `yMUSD` LP tokens
- Pool uses this MUSD as collateral when filling short positions

### Overflow: Protocol Trove (optional, owner-managed)
- Owner registers a Mezo Trove owned by the protocol
- When MUSD utilisation > 80%, pool uses Trove equity as margin for new shorts
- LTV guard: pool checks Trove health factor before using Trove margin
- If Trove health factor < 1.5, falls back to MUSD only
- Trove margin is not depositor capital — it's protocol-owned BTC

### LP Token — `yMUSD`
- Minted: `shares = amount * totalShares / totalAssets`
- Burned: `musdOut = shares * totalAssets / totalShares`
- `totalAssets` = free MUSD + locked collateral + accrued premiums - settled losses

---

## Withdrawals — Utilisation-Based

```
availableLiquidity = totalAssets - lockedCollateral
maxWithdraw(user) = userShares * availableLiquidity / totalShares
```

- Instant for free portion
- Locked portion released as options expire or settle
- No timelock, no queue

---

## Pricing — Black-Scholes

Pool computes fair premium on-chain for every long order:

```
d1 = (ln(spot/strike) + (r + 0.5*iv²)*T) / (iv*√T)
d2 = d1 - iv*√T
call premium = spot*N(d1) - strike*e^(-rT)*N(d2)
put premium  = strike*e^(-rT)*N(-d2) - spot*N(-d1)
```

- `spot`: from Skip oracle (Chainlink-compatible, updates every block)
- `iv`: owner-adjustable, 50%–150%, default 80%
- `r`: hardcoded 0.05
- `T`: timeToExpiry in years

Pool fills long orders only if `order.premium >= bsPrice * (1 - 0.05)` — 5% tolerance.

Normal distribution approximation: Abramowitz & Stegun (already in codebase).

---

## Order Flow

### Long order (buyer) — pool fills automatically

```
1. User calls createLongOrder(type, strike, quantity, expiry, premium)
2. User transfers premium MUSD to contract
3. Contract computes BS fair price
4. If pool has capital AND premium >= BS*(0.95):
   → pool fills atomically, option is live immediately
   → premium credited to pool (minus protocol fee)
   → pool locks collateral
5. If pool cannot fill:
   → order sits on book (active, unfilled)
   → any manual short seller can fill it via fillShort()
```

### Short order (manual seller) — peer-to-peer

```
1. Seller calls createShortOrder(type, strike, quantity, expiry, premium)
2. Seller locks collateral (MUSD)
3. Any buyer calls fillLong(id), pays premium
4. Premium goes to seller (minus protocol fee)
```

### Settlement (long exercises)

```
1. Long calls settle(id)
2. Contract checks option is ITM using spot oracle
3. Computes cash profit:
   - Call: max(0, spot - strike) * quantity / 1e18
   - Put:  max(0, strike - spot) * quantity / 1e18
4. Pays profit to long from collateral
5. Returns remaining collateral to short (pool or human)
6. Marks settled
```

### Expiry refund

```
1. Either party calls refund(id) after expiry
2. If not settled: full collateral returned to short, premium already paid
3. Pool performance fee taken from net profit at this point
```

---

## Collateral Requirements

### Pool short (cash-settled, MUSD):
- **Call**: `(spot * 2 - strike) * quantity / 1e18` — covers max realistic payout while accounting for strike already paid by long
- **Put**: `strike * quantity / 1e18` — max payout if BTC goes to zero

### Manual short (MUSD or Trove margin):
- **MUSD (type 1)**: same as pool short, seller posts full MUSD collateral upfront
- **Trove margin (type 2)**: seller signs EIP-712 `adjustTroveWithSignature` via `BorrowerOperationsSignatures` — collateral drawn from Trove equity only if option is exercised. Trove equity must cover required collateral at fill time and at settlement.

---

## Protocol Revenue

### 1. Premium fee — 2% of every premium
```
protocolFee = premium * protocolFeeBps / 10000   // default 200 bps
poolOrSellerReceives = premium - protocolFee
feeRecipient.transfer(protocolFee)
```
Applied on both pool-filled and manually-filled orders.

### 2. Pool performance fee — 15% of net yield
```
netYield = totalPremiumsReceived - totalSettlementsPaid
performanceFee = netYield * performanceFeeBps / 10000  // default 1500 bps
```
Taken pool-wide at each settlement and expiry refund event.
Credited to `feeRecipient`.

### Fee parameters (owner-adjustable)
| Parameter | Default | Max |
|---|---|---|
| `protocolFeeBps` | 200 (2%) | 500 (5%) |
| `performanceFeeBps` | 1500 (15%) | 3000 (30%) |
| `feeRecipient` | deployer | any address |

---

## Exposure Limits

| Parameter | Default | Adjustable |
|---|---|---|
| TVL cap | 50,000 MUSD | Owner |
| Max single option collateral | 10,000 MUSD | Owner |
| IV range | 50%–150% | Owner (within range) |

Pool refuses to fill if `lockedCollateral + newCollateral > totalAssets` or `totalAssets >= tvlCap`.

---

## Owner Functions

```solidity
function setIV(uint256 iv) external onlyOwner
function setTVLCap(uint256 cap) external onlyOwner
function setMaxOptionCollateral(uint256 max) external onlyOwner
function setFeeRecipient(address r) external onlyOwner
function setProtocolFeeBps(uint256 bps) external onlyOwner
function setPerformanceFeeBps(uint256 bps) external onlyOwner
function registerTrove(address troveManager, address borrowerOps) external onlyOwner
function pausePool() external onlyOwner
function unpausePool() external onlyOwner
```

---

## Frontend

### Pool tab (new)
- Deposit MUSD → mint yMUSD
- Withdraw yMUSD → receive MUSD
- Stats: pool size, utilisation %, 7d trailing APY, your share value

### Order book
- Long orders filled by pool show instantly as live (no "waiting for counterparty")
- Unfilled long orders (pool at cap) show "Open — awaiting filler"
- Short orders show as before

### Place order
- Long order: user sets strike, quantity, expiry — pool quotes premium via BS
- Short order: user sets all params, posts collateral

### Your positions
- Shows all active options, Greeks (delta, theta), countdown to expiry, settle button if ITM

---

## Bot (testnet only)

- Places long and short orders as simulated users
- Exercises options when ITM
- Does NOT provide liquidity — pool handles that
- Helps stress-test pool pricing and collateral logic

---

## What This Replaces

| V1 | V2 |
|---|---|
| CallOption.sol + PutOption.sol | Single OptionPool.sol |
| Physical BTC settlement | Cash settlement (MUSD only) |
| Bot provides liquidity | Pool provides liquidity |
| Manual premium pricing | BS-quoted premium |
| No protocol revenue | 2% premium fee + 15% performance fee |
| No LP token | yMUSD ERC20 |

---

## Out of Scope (V3)

- Delta hedging
- Dynamic IV from on-chain vol surface
- Partial fills
- Multi-collateral LP deposits (BTC)
- Governance

---

## Open Questions — RESOLVED

1. Call collateral cap — `(spot * 2 - strike) * quantity / 1e18`
2. Manual short sellers — Trove margin (EIP-712 via `BorrowerOperationsSignatures`) supported alongside MUSD

## Mezo-Specific Notes (from docs)

- Solidity: `0.8.28`, `evmVersion: "london"`, optimizer enabled
- Testnet chainId: 31611, Mainnet chainId: 31612
- MUSD contracts: `mezo-org/musd` — verify interface before integrating
- Gas paid in BTC on Mezo — no ETH needed
- Mezo Passport (`@mezo-org/passport`) supports native BTC wallets (Xverse, Unisat) + EVM wallets — consider for frontend wallet connection
