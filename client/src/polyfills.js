// Node globals that Mezo Passport's Bitcoin-wallet libraries expect. Imported first by WalletProviders.jsx, so it
// runs before those libraries load (only on wallet pages; the landing page never loads this).
import { Buffer } from 'buffer';

if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {}, browser: true, version: '' };
