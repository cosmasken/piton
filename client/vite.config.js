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
  server: { port: 3000 },
  optimizeDeps: {
    include: ['./src/addon/canvasjs.min.js'],
  },
});
