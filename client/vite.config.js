import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Surge serves 200.html for any unknown path, which is what makes client-side routes such as
// /dashboard survive a page refresh. Copy the built index.html once the bundle is written, so
// every build (npm run build, npx vite build, CI) produces a matching 200.html.
const spaFallback = () => {
  let outDir = 'dist';
  return {
    name: 'spa-fallback-200',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { outDir = config.build.outDir; },
    writeBundle(options) {
      const dir = options.dir || outDir;
      const index = join(dir, 'index.html');
      if (!existsSync(index)) throw new Error(`spa-fallback-200: ${index} not found`);
      copyFileSync(index, join(dir, '200.html'));
    },
  };
};

export default defineConfig({
  plugins: [react(), spaFallback()],
  // Mezo Passport's Bitcoin-wallet libraries expect Node's `global`; in the browser that is globalThis
  define: { global: 'globalThis' },
  server: { port: 3000 },
  build: {
    // Split third-party code into stable chunks: they change rarely, so browsers cache them across releases,
    // and the landing page doesn't download the trading libraries.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/lightweight-charts|fancy-canvas/.test(id)) return 'charts-lw';
          // Recharts is left to the bundler: it is only reached through lazy imports (payoff and depth charts)
          if (/[\\/](ethers|@adraffy)[\\/]/.test(id)) return 'ethers';
          // wallet libraries (wagmi, viem, RainbowKit, Mezo Passport) are only reached through the lazy wallet pages:
          // left to the bundler so they stay out of the landing page
          if (/react-dom|react-router|scheduler|[\\/]react[\\/]/.test(id)) return 'react';
          return undefined; // everything else: let the bundler decide (keeps lazy-only code like Recharts out of the first load)
        },
      },
    },
  },
});
