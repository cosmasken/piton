# Piton — Bitcoin Options on Mezo

## Screenshot

![Trading Page](https://ibb.co/bgSjvFrw)

## Description

### Overview

- Piton is a decentralized OTC (Over The Counter) options platform for Bitcoin call & put options on **Mezo** — the Bitcoin finance chain.
- Options are priced and settled in **MUSD**, Mezo's Bitcoin-backed stablecoin (1:1 with USD).
- American-style options with a fixed expiry of **48 hours** from creation.
- All orders are listed on-chain via smart contracts. Counterparties can take the LONG or SHORT position directly from the order book.
- The SHORT position is always collateralised — either with the underlying BTC amount, or a **2/3 margin in MUSD**.
- Settlements can be done any time before expiry, in **BTC** or **MUSD**. Settlement type is chosen by the party selling the underlying asset.
- BTC/USD market prices are sourced from **[Skip oracle](https://mezo.org/docs/developers/)** deployed on Mezo (Chainlink-compatible `latestRoundData` interface, updated every block). Prices older than 2 hours are rejected on-chain.
- Deployed on **Mezo matsnet** (testnet, chainId 31611). Contracts are unaudited — do not use with real funds.

### Deployed Contracts (Mezo matsnet)

| Contract | Address |
|---|---|
| CallOption | `0xd24fbb05E888aD3F22bEC8323D6D164Ec49bDDb7` |
| PutOption | `0x5c3b1e87668DEF8909500640099068CE20c78416` |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |

### Mainnet Addresses (when ready)

| Contract | Address |
|---|---|
| MUSD | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| Skip Oracle (BTC/USD) | `0x7b7c000000000000000000000000000000000015` |

### Technical Stack

- **Front-end:** React 18, Ethers.js v6, React Router v6, Bootstrap 5
- **Smart Contracts:** Solidity 0.6.12 (Hardhat)
- **Charts:** [CanvasJS](https://canvasjs.com/) + Binance public API (BTC/USD)
- **Oracle:** [Skip oracle](https://mezo.org/docs/developers/) (Chainlink-compatible BTC/USD feed on Mezo)
- **Chain:** [Mezo](https://mezo.org) (EVM-compatible, Bitcoin L2)

## Running Locally

_Requires a Web3 wallet (e.g. MetaMask) connected to Mezo matsnet._

```
RPC:     https://rpc.test.mezo.org
ChainID: 31611
```

After cloning the repo:

```bash
cp .env.example .env        # add your PRIVATE_KEY (deployer only)
npm install                 # root dependencies
npm run client-install      # React client dependencies
npm run dapp                # launch on localhost:3000
```

## Deploying Contracts

```bash
npm run deploy:testnet   # Mezo matsnet (chainId 31611)
npm run deploy:mainnet   # Mezo mainnet  (chainId 31612)
```

## Mezo Testnet Setup

1. Add Mezo matsnet to your wallet (RPC: `https://rpc.test.mezo.org`, ChainID: `31611`)
2. Get test BTC and MUSD from the faucet: https://faucet.test.mezo.org
3. To get MUSD: borrow against test BTC at https://testnet.mezo.org

## Relevant Links

- **Mezo docs:** https://mezo.org/docs/developers/
- **Mezo testnet dApp:** https://testnet.mezo.org
- **Skip oracle:** https://mezo.org/docs/developers/
