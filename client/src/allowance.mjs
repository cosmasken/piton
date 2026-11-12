// Approvals: only ask the wallet for an ERC-20 approval when the existing allowance is too low.
// When an approval is needed it is for the exact amount (never unlimited), so skipping it never widens access.

/**
 * Make sure `spender` may pull `amount` of `token` from the signer's wallet.
 * `token` is an ethers Contract (connected to a signer) with allowance/approve; `amount` is a bigint (wei).
 * Returns true if an approval transaction was sent, false if the existing allowance already covered it.
 */
export async function ensureAllowance(token, spender, amount) {
  const owner = await token.runner.getAddress();
  const current = await token.allowance(owner, spender);
  if (current >= amount) return false;
  await (await token.approve(spender, amount)).wait();
  return true;
}
