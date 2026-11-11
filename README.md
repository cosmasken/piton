# Piton — Bitcoin Options on Mezo

> Peer-to-peer and pool-backed BTC options, priced and cash-settled in MUSD, on the Mezo Bitcoin L2.

## What is Piton?

Piton is an options market built on [Mezo](https://mezo.org), the Bitcoin finance chain. Anyone can buy or sell American-style BTC calls and puts, either against a shared liquidity pool or directly against another wallet.

- **Cash-settled in MUSD.** MUSD is Mezo's Bitcoin-backed stablecoin (1:1 USD). Premiums, collateral and payouts are all MUSD; no BTC changes hands.
- **American-style.** The buyer can exercise any time before expiry. Expiry is chosen per order, from 15 minutes to 14 days.
- **Pool as default counterparty.** The liquidity pool sells options automatically, so buy orders fill instantly when the pool has capital.
- **Fully collateralised.** Every short (pool or human) locks the maximum possible payout up front.
- **Mezo-native.** BTC/USD comes from Mezo's Skip oracle, and short sellers can borrow their margin from their Mezo Trove.

---

## How it works

### Buying an option (long)

1. Choose **Call** or **Put**, then set strike, quantity, expiry and the premium you are willing to pay.
2. The pool quotes a Black-Scholes price at its **ask volatility** (mid IV + 15%). Click **BS** in the order form to fetch the quote.
3. If your premium is at least 95% of the pool's ask and the pool has free capital, the pool fills your order in the same transaction.
4. Otherwise the order stays on the book as a **bid**, and any wallet can sell it to you.

### Selling an option (short)

- **Post a new ask.** Place a sell order with MUSD collateral (or Trove margin, below). It waits on the book until a buyer clicks **Buy →**.
- **Sell into a bid.** Click **Sell →** next to a bid in the order book. You lock the collateral and receive the premium, minus the 2% protocol fee.

### Collateral and maximum payout

| | Collateral the short locks | Buyer's maximum payout |
|---|---|---|
| Put | `strike × qty` | `strike × qty` (BTC goes to 0) |
| Call | `(3 × spot − strike) × qty` | Reached when BTC hits 3× the spot price at fill |

Payouts are capped at the locked collateral. The order form shows the max payout for every buy, and warns when a call's strike is at or above the 3× cap (it could never pay out). Calls with zero collateral are rejected.

### Settlement

- The **buyer** settles any time before expiry while the option is in the money, and receives the profit in MUSD at the oracle price.
- Any unused collateral returns to the short (or stays in the pool).
- After expiry, anyone can call **Refund** on an unexercised option, releasing the collateral to the short or back to the pool.
- Unfilled orders can be cancelled by their creator for a full refund.

---

## Using the Dapp

Anyone can browse without a wallet; connect only to trade.

- **Option chain.** Pick an expiry, then click a strike. Calls are on the left, puts on the right, with the pool's price (marked with a dot), resting bids and asks, and delta. Click an ask to buy or a bid to sell into it.
- **Trade panel.** Buy at the pool's price (market) or with a limit price; sell by posting collateral and a price. Before signing you see the cost, the worst case, the best case, the break-even and a profit-and-loss chart at expiry. If the pool won't sell an order itself (strike too far from spot, too little time left, circuit breaker, pool too busy) it says why and the order rests as a bid.
- **Order book and trades.** The selected option's resting orders sit under the trade form; all orders and recent fills have their own tabs.
- **Positions.** Entry price, mark price, profit and loss, delta, break-even and a payoff chart per position; sell an option back to the pool, exercise a winning option, turn on auto-exercise, cancel a resting order, or refund after expiry.
- **Closing early.** Options bought from the pool can be sold back to it at any time before expiry. The pool pays its mid-volatility value less a 10% volatility spread (it sells at mid plus 15% and a utilisation markup), so a round trip always costs a little. Exercising a winning option pays its full exercise value and is never blocked.
- **Account and history.** The left panel sums your wallet, pool share, open positions, and open and realised P&L.
  Positions → History lists every action (from the subgraph) with realised P&L and CSV export; open positions show
  portfolio delta, gamma, theta and vega. A banner (and optional browser notification) warns when an option you hold
  is in the money near expiry with auto-exercise off.
- **Settings (⚙).** Default size, price unit, sell-back slippage, alert window, notifications. Keyboard: arrows move
  around the chain, B / S pick the side, Enter reviews the order; 1-6 chart interval, F full-screen chart.
- **Stats (`/stats`).** All-time volume, trades, traders and LPs, payouts and daily history, from the subgraph.
- **Read-only view.** `?watch=0x…` shows any address's account, positions and history without connecting a wallet.
- **Share a trade.** The address bar carries the selected option (`?i=P-74000-<expiry>`).
- Expiries are standard slots (the next hours, daily 08:00 UTC, Fridays out to two weeks) so orders for the same option meet in one book. Prices are MUSD per 1 BTC option.

Not yet built: selling an option back when it was bought from another trader rather than the pool, and historical charts of pool yield (those need an indexer).

---

## Liquidity Pool

Anyone can deposit MUSD and receive **yMUSD** LP tokens.

- Pool capital is the short side of every pool-filled option.
- LPs earn the net premium on every pool fill, and keep collateral from options that expire worthless. They pay out when options finish in the money.
- Withdrawals are instant up to the unlocked balance; locked collateral frees up as options settle or expire.
- **Pricing.** The pool sells at `mid IV × 1.15`. The mid IV is updated hourly by a keeper from Deribit's BTC volatility index (DVOL), within 25%–150%.
- **Limits.** 50,000 MUSD pool cap and 10,000 MUSD collateral per option (owner-adjustable). Trading can be paused by the owner or a guardian key (only the owner can unpause).
- **Pool protections** (live on the matsnet deployment below; testnet sets the minimum pool expiry to 15 minutes, the default is 1 hour):
  - Share price counts unearned premium as a liability, so nobody can join just before a sale or leave just after one to capture premium.
  - 1-hour deposit lock; 0.25% withdrawal fee while options are open (stays in the pool).
  - The pool sells only strikes within 30% of spot, with at least 1 hour left, at least 5% a year of rent on locked collateral, a price markup that rises with utilisation, and never past 80% utilisation or 25% of the pool in one option.
  - Circuit breaker: a 5% move in 10 minutes pauses pool fills and deposits for 30 minutes. Withdrawals, settlement and refunds stay open.
  - Opt-in auto-exercise: owners can allow a keeper to exercise in-the-money options in the last 5 minutes for 0.5% of the payout.
  - Two-step ownership, and an optional timelock owner (`PitonTimelock`).
- **After a total loss**, deposits are blocked until worthless yMUSD is cleared, so new depositors are never diluted by old shares.

### Fees

| Fee | Rate | Charged on |
|---|---|---|
| Protocol fee | 2% | Every premium (pool fills and peer-to-peer fills) |
| Performance fee | 15% | The pool's cumulative net yield (premiums earned minus payouts), never on principal |

The 15% IV margin is a pricing buffer that stays with LPs; it is not a protocol fee.

---

## Trove Margin

Mezo users borrow MUSD against BTC in a **Trove**. Piton lets a short seller fund their margin straight from their Trove instead of from their wallet.

- When you place a short order with **Trove Margin**, you sign a Mezo `WithdrawMUSD` for exactly the margin amount. Piton submits it in the same transaction: Mezo mints the MUSD to your wallet as new Trove debt and the pool immediately takes it as collateral.
- **Your BTC never leaves your Trove.** In exchange you carry the borrowed MUSD as debt (plus Mezo's 0.1% borrowing fee and interest) until you repay it.
- Your Trove must stay at **≥150% collateral ratio after the draw**, a buffer above Mezo's 110% liquidation level.
- After settlement or expiry the unused margin returns to your wallet as MUSD. Repay your Trove with it at [testnet.mezo.org](https://testnet.mezo.org).
- Nothing is stored or replayable: the signature is used once, and it pays out only to your own wallet.

### Protect my Trove

Above the buy form, **🛡 Protect my Trove** reads your Trove and shows its collateral ratio and liquidation price (`debt × 110% / collateral`). It then suggests a put that pays MUSD as BTC falls toward liquidation:

- Strike 15% above your liquidation price.
- Size up to 100% of your Trove's BTC (coverage slider), capped by the pool's per-option limit.
- **Fill order form** prefills the put, priced at the pool's ask + 2%.

---

## Oracle

BTC/USD comes from Mezo's **Skip oracle** at `0x7b7c000000000000000000000000000000000015`. Mezo's validators agree the price during block consensus (Skip Connect) and expose it through a Chainlink-compatible `latestRoundData()`; it updates every block. Mezo's own MUSD `PriceFeed` reads this same contract, so Piton and Trove liquidations see the same price.

- The contract rejects prices older than **30 seconds** (`PRICE_STALENESS`, about 7 Mezo blocks) for orders, pool sales, sell-back and deposits, and older than **120 seconds** for exercise, so a brief oracle pause near expiry can't cost a holder a winning option. (The live testnet pool predates this and uses 300 s.)
- The dapp uses the 30 s limit, measured against the block timestamp. When the oracle is stale it shows a Binance fallback price for display only and disables order submission.
- Other ecosystem prices in the sidebar come from Pyth and are labelled as such; they are not used by the contracts.

---

## Deployed Contracts — Mezo Matsnet (chainId 31611)

Redeployed 10 Nov 2026 from the current contracts (premium-lock NAV, deposit lock and withdrawal fee, utilisation and strike limits, minimum rent, circuit breaker, auto-exercise, guardian; earlier: pricing fixes, Trove margin redesign, bids, 3× call cap, IV keeper role, immediate-exercise price floor, NAV-based LP shares, high-water-mark performance fee). Earlier deployments are retired.

| Contract | Address |
|---|---|
| OptionPool | `0x21F83eEcF5561AB721ec4f8E96279EC1BFCb8221` |
| yMUSD (LP token) | `0x09Da1957c5E435894D4d11451e9a7b2C9C24500c` |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |
| Mezo TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` |
| Mezo BorrowerOperationsSignatures | `0xD757e3646AF370b15f32EB557F0F8380Df7D639e` |

### Mezo mainnet (chainId 31612): Piton is not deployed

| Contract | Address |
|---|---|
| MUSD | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |
| Mezo TroveManager | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` |
| Mezo BorrowerOperationsSignatures | `0xB57ab578BF20b3e318f3EFAA587C51DBccE5df7a` |

---

## Running Locally

You need a browser wallet (e.g. MetaMask) on Mezo matsnet:

```
RPC:     https://rpc.test.mezo.org
ChainID: 31611
```

```bash
cp .env.example .env        # PRIVATE_KEY is only needed for deploying
npm install                 # Hardhat + contract deps
npm run client-install      # React client deps
npm run dapp                # http://localhost:3000
```

If your wallet is on another network, the dashboard shows a **Switch Network** button.

### Getting test tokens

1. Add Mezo matsnet to your wallet (RPC `https://rpc.test.mezo.org`, chainId `31611`).
2. Get test BTC from the faucet: https://faucet.test.mezo.org
3. Open a Trove and borrow MUSD against your test BTC: https://testnet.mezo.org

---

## Testing

```bash
npm test               # core OptionPool suite
npm run test:all       # all contract suites (unit, edge cases, IV keeper, Mezo integration)
npm run test:client    # Protect-my-Trove sizing maths (node:test)

npm run fetch:mezo     # one-time: fetch Mezo's MUSD protocol contracts (mezo-org/musd, pinned commit)
npm run test:mezo      # run Piton against the real Mezo contracts on the Hardhat network
```

The Mezo integration suite deploys Mezo's actual Trove, MUSD and signature contracts locally and tests Trove-funded margin end to end, including replay and front-running attempts. Mezo's contracts are GPL-3.0, so they are downloaded on demand into `contracts/mezo` (gitignored) instead of being copied into this repo; without them the suite is skipped.

---

## Deploying and Operating

Deployment, keeper and monitoring scripts are operational tooling and are not part of this repository; they are kept privately. The contracts take five constructor arguments (MUSD, yMUSD, Skip oracle, TroveManager, BorrowerOperationsSignatures); the Mezo addresses are in the tables above. After a deploy, put the new `pool` and `ymusd` addresses in `client/src/network.mjs` (on mainnet they are zero-address placeholders today; replacing them switches the dapp from "not live" to live automatically).

What has to run off-chain for the protocol to work well: a keeper that sets the pool's IV from Deribit DVOL (a dedicated key that can only change IV), a keeper that exercises options whose owners opted in during the last 5 minutes (earns 0.5% of the payout), and periodic refunds of expired pool options. Ownership is two-step and can move to a timelock; a guardian key can pause but not unpause. Don't deploy to mainnet until the contracts are audited.

---

## Indexer (Goldsky subgraph)

`subgraph/` indexes the OptionPool: options with their full lifecycle, trades, per-account activity, live pool state and
hourly/daily pool snapshots (assets, locked collateral, share price, IV, volume, payouts, deposits, withdrawals), IV
updates and circuit-breaker trips.

- Testnet endpoint (stable tag): `https://api.goldsky.com/api/public/project_cm3n60bzt1tjh01u89zk3d2n9/subgraphs/piton-testnet/prod/gn`
- The dapp reads trade history from it and falls back to scanning chain logs if it is unavailable.
- After a contract redeploy: `npm run subgraph:deploy`. It reads the new address and start block from
  `deployments/matsnet.json`, deploys a new version, waits for it to sync, then moves the `prod` tag, so the dapp's URL
  never changes. Needs `goldsky login` once and `npm install --prefix subgraph`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v3 |
| Wallet | wagmi v3, viem, ethers v6 |
| State | Zustand |
| Charts | Recharts |
| Contracts | Solidity 0.8.28, Hardhat, OpenZeppelin 5 |
| Oracle | Mezo Skip oracle (BTC/USD, every block); Deribit DVOL for IV (off-chain keeper) |
| Indexer | Goldsky subgraph (The Graph tooling, AssemblyScript mappings) |
| Mezo integration | TroveManager reads, BorrowerOperationsSignatures (`withdrawMUSDWithSignature`) |
| Chain | Mezo (EVM-compatible Bitcoin L2) |

---

## Security

The contracts are **unaudited** and deployed on testnet only. Do not use them with real funds. Known limitations and open work are tracked in [TECH_DEBT.md](TECH_DEBT.md); the Trove integration design is in [TROVE_PLAN.md](TROVE_PLAN.md).
