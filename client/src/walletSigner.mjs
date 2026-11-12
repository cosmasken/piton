// One ethers signer for both wallet types.
//
// EVM wallets (MetaMask etc.) work through ethers' BrowserProvider as before. Mezo Passport Bitcoin wallets
// (Unisat, OKX, Xverse) are different: their wallet client has no keys behind its transport. Each Mezo transaction
// is sent by the client's own sendTransaction({ to, value, data }), which executes it from the user's Safe smart
// account via Mezo's relayer, after a message signature in the Bitcoin wallet. This adapter lets every existing
// `contract.method(...)` call and `.wait()` keep working for those users.
import { AbstractSigner } from 'ethers';

/** True for a Mezo Passport Bitcoin-wallet client (OrangeKit adds sendBitcoin to the viem wallet client). */
export const isBitcoinWalletClient = walletClient => typeof walletClient?.sendBitcoin === 'function';

export class PassportSigner extends AbstractSigner {
  /**
   * @param walletClient the Passport (OrangeKit) wallet client from wagmi's useWalletClient()
   * @param provider     an ethers provider for reads and for looking up the relayed transaction
   * @param opts         { pollMs, attempts } how long to wait for the relayed transaction to be visible
   */
  constructor(walletClient, provider, opts = {}) {
    super(provider);
    this.walletClient = walletClient;
    this.pollMs = opts.pollMs ?? 1500;
    this.attempts = opts.attempts ?? 60;
  }

  connect(provider) { return new PassportSigner(this.walletClient, provider, { pollMs: this.pollMs, attempts: this.attempts }); }

  async getAddress() { return this.walletClient.account.address; }

  async signTransaction() {
    throw new Error('Bitcoin wallets sign each transaction through the Mezo smart account; it cannot be signed separately.');
  }

  async signMessage(message) {
    return this.walletClient.account.signMessage({ message: typeof message === 'string' ? message : { raw: message } });
  }

  async signTypedData() {
    throw new Error('Bitcoin wallets (Mezo Passport) cannot sign typed data.');
  }

  /** Send through the smart account and return ethers' TransactionResponse for the relayed transaction. */
  async sendTransaction(tx) {
    const call = await this.populateCall(tx);
    const hash = await this.walletClient.sendTransaction({
      to: call.to,
      data: call.data ?? '0x',
      value: call.value != null ? BigInt(call.value) : 0n,
    });
    for (let i = 0; i < this.attempts; i++) {
      const res = await this.provider.getTransaction(hash);
      if (res) return res;
      await new Promise(r => setTimeout(r, this.pollMs));
    }
    throw new Error(`Relayed transaction ${hash} was not found on Mezo yet. Check the explorer before retrying.`);
  }
}
