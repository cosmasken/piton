import {
  getConfig,
  unisatWalletMezoTestnet, okxWalletMezoTestnet, xverseWalletMezoTestnet,
  unisatWalletMezoMainnet, okxWalletMezoMainnet, xverseWalletMezoMainnet,
} from '@mezo-org/passport';
import { injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';

// Wallets for one Mezo network, through Mezo Passport (RainbowKit + Bitcoin wallets).
// - Bitcoin wallets (Unisat, OKX, Xverse) get a Mezo smart account (see walletSigner.mjs).
// - EVM wallets: any installed browser wallet is found automatically (EIP-6963) and listed as "Installed";
//   MetaMask, Rainbow, Coinbase and WalletConnect (mobile / QR) need a WalletConnect project ID, so they are only
//   listed when VITE_WALLETCONNECT_PROJECT_ID is set in client/.env.
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

const BITCOIN_WALLETS = {
  testnet: [unisatWalletMezoTestnet, okxWalletMezoTestnet, xverseWalletMezoTestnet],
  mainnet: [unisatWalletMezoMainnet, okxWalletMezoMainnet, xverseWalletMezoMainnet],
};

function walletGroups(network) {
  const evm = WALLETCONNECT_PROJECT_ID
    ? [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
    : [injectedWallet];
  return [
    { groupName: 'Bitcoin wallets', wallets: BITCOIN_WALLETS[network] },
    { groupName: 'Ethereum wallets', wallets: evm },
  ];
}

// One config per network (Passport serves one Mezo network per config); built once and reused.
const configs = {};
export function buildWagmiConfig(network) {
  const key = network === 'mainnet' ? 'mainnet' : 'testnet';
  return (configs[key] ||= getConfig({
    appName: 'Piton',
    appDescription: 'Bitcoin options on Mezo, settled in MUSD',
    appUrl: 'https://piton.surge.sh',
    mezoNetwork: key,
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID || undefined,
    wallets: walletGroups(key),
    ssr: false,
  }));
}
