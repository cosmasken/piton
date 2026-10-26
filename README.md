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
- BTC/USD market prices are sourced from **[Pyth Network](https://pyth.network/)** oracles deployed on Mezo.
- Deployed on **Mezo matsnet** (testnet, chainId 31611). Mainnet-ready.

### Deployed Contracts (Mezo matsnet)

| Contract | Address |
|---|---|
| CallOption | `0x278269C888E18D73c315Df8BDE54711905637516` |
| PutOption | `0x58579360e86BD2f489578b410C5284757EE517Ca` |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| BTC/USD Feed ID | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |

### Mainnet Addresses (when ready)

| Contract | Address |
|---|---|
| MUSD | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

### Technical Stack

- **Front-end:** React 18, Ethers.js v6, React Router v6, Bootstrap 5
- **Smart Contracts:** Solidity 0.6.12 (Hardhat)
- **Charts:** [CanvasJS](https://canvasjs.com/) + Binance public API (BTC/USD)
- **Oracle:** [Pyth Network](https://pyth.network/) (BTC/USD on Mezo)
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
- **Pyth oracle docs:** https://docs.pyth.network/
