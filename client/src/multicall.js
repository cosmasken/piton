import { ethers } from 'ethers';

// Multicall3 is deployed at the same address on most EVM chains, including Mezo mainnet and testnet
// (verified on both: code present, aggregate3 and getBlockNumber work).
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const MC_IFACE = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function getEthBalance(address) view returns (uint256)',
  'function getBlockNumber() view returns (uint256)',
  'function getCurrentBlockTimestamp() view returns (uint256)',
]);

/**
 * Run many view calls in one eth_call. calls: [{ target, iface, fn, args }].
 * Returns one entry per call: the decoded value (a single return value is unwrapped), or null if it failed.
 * Batches are split into chunks sent in parallel: Mezo's RPC caps the gas of one eth_call at about 1M, so
 * expensive calls need small chunks (quotePremium costs ~83k gas, so at most ~10 fit; use chunk = 8).
 */
export async function multicall(provider, calls, chunk = 40) {
  const parts = [];
  for (let i = 0; i < calls.length; i += chunk) parts.push(calls.slice(i, i + chunk));
  const results = await Promise.all(parts.map(part => runChunk(provider, part)));
  return results.flat();
}

async function runChunk(provider, part) {
  const out = [];
  {
    const data = MC_IFACE.encodeFunctionData('aggregate3', [part.map(c => ({
      target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args || []),
    }))]);
    const raw = await provider.call({ to: MULTICALL3, data });
    const [res] = MC_IFACE.decodeFunctionResult('aggregate3', raw);
    res.forEach((r, j) => {
      if (!r.success) { out.push(null); return; }
      try {
        const d = part[j].iface.decodeFunctionResult(part[j].fn, r.returnData);
        out.push(d.length === 1 ? d[0] : d);
      } catch { out.push(null); }
    });
  }
  return out;
}
