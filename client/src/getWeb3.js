import { BrowserProvider } from 'ethers';

/**
 * Returns a BrowserProvider and the connected signer from MetaMask/EIP-1193 wallet.
 */
export default async function getProvider() {
  if (!window.ethereum) throw new Error('No Web3 wallet detected. Please install MetaMask.');
  const provider = new BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  return provider;
}
