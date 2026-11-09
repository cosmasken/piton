# Piton — Bitcoin Options on Mezo

> Decentralised OTC options for BTC, priced and settled in MUSD, on the Mezo Bitcoin L2.

## What is Piton?

Piton is a peer-to-peer options trading platform built on [Mezo](https://mezo.org) — the Bitcoin finance chain. It lets anyone create, fill, and settle American-style BTC call and put options without an intermediary.

- Options are priced and settled in **MUSD** — Mezo's Bitcoin-backed stablecoin (1:1 USD)
- **American-style** — exercise any time before expiry (15 minutes to 14 days, chosen at order creation)
- The short (seller) is always fully collateralised — no undercollateralised risk
- BTC/USD price from the **Skip oracle** (Chainlink-compatible, updated every block)

---

## How it works

### Placing an order

1. Choose **Long** (buy) or **Short** (sell), and **Call** or **Put**
2. Set your strike price, premium, and quantity
3. Submit — the order appears in the on-chain order book

### Filling an order

Any wallet can take the opposite side of an open order directly from the order book. Click **Fill →** next to any order.

### Settlement

- The **long party** can settle any time before expiry if the option is in the money
- **Call settlement**: long pays strike in MUSD, receives BTC — or takes cash-settled profit
- **Put settlement**: long sends BTC, receives strike in MUSD — or takes cash-settled profit
- After expiry, both parties can reclaim their collateral via **Refund**

---

## Trove Margin — Piton's unique feature

Short sellers normally lock up BTC or MUSD as collateral. Piton uniquely supports **Mezo Trove equity as margin**:

- If you have an active Mezo Trove (a BTC-collateralised borrowing position), you can use its equity as margin for short options
- **No capital lockup** — your BTC stays in your Trove earning yield
- Implemented via EIP-712 signed `adjustTroveWithSignature` — the option contract draws margin from your Trove only if the option is exercised against you
- Select **"Trove (Mezo)"** in the margin dropdown when placing a short order

This is not available on any other options protocol.

---

## Deployed Contracts — Mezo Matsnet (testnet, chainId 31611)

| Contract | Address |
|---|---|
| CallOption | `0xaDaf8284CD398c96f57606027f39A06Ad4b209CD` |
| PutOption | `0x233fd0a11428B6749540AB78B6Ddd3C268Ac5033` |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |

### Mainnet Addresses (when ready)

| Contract | Address |
|---|---|
| MUSD | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |

---

## Running Locally

Requires a Web3 wallet (MetaMask) connected to Mezo matsnet:

```
RPC:     https://rpc.test.mezo.org
ChainID: 31611
```

```bash
cp .env.example .env        # add PRIVATE_KEY (deployer only)
npm install                 # root deps (Hardhat)
npm run client-install      # React client deps
npm run dapp                # launches on localhost:3000
```

## Deploying Contracts

```bash
npm run deploy:testnet   # Mezo matsnet (chainId 31611)
npm run deploy:mainnet   # Mezo mainnet  (chainId 31612)
```

## Getting Test Tokens

1. Add Mezo matsnet to your wallet (RPC: `https://rpc.test.mezo.org`, ChainID: `31611`)
2. Get test BTC from the faucet: https://faucet.test.mezo.org
3. Borrow MUSD against your test BTC: https://testnet.mezo.org

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS v3 |
| Wallet | wagmi v3, viem |
| State | Zustand |
| Charts | Recharts |
| Contracts | Solidity 0.6.12, Hardhat |
| Oracle | Skip oracle (Chainlink-compatible BTC/USD, updated every block) |
| Chain | Mezo (EVM-compatible Bitcoin L2, chainId 31611) |

---

## Security

Contracts are **unaudited**. Deployed on testnet only. Do not use with real funds.
