// Node globals that Mezo Passport's Bitcoin-wallet libraries expect. App.jsx loads this before any wallet page
// (and WalletProviders.jsx imports it first too); the landing page never loads it.
import { Buffer } from 'buffer';

if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {}, browser: true, version: '' };
