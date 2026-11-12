import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [react()],
  // Build metadata shown on the platform System Health page.
  define: { __ZENIX_VERSION__: JSON.stringify(version) },
  server: { port: 5173, host: true },
  build: {
    sourcemap: false,
    target: 'es2020',
    // React and the router change rarely: a separate chunk keeps them cached across app releases.
    rollupOptions: { output: { manualChunks: (id: string) => {
      const path=id.replace(/\\/g,'/')
      if(path.includes('/node_modules/'))return 'vendor'
      if(path.endsWith('/src/domain/actions.ts'))return 'domain-actions'
      return undefined
    } } }
  }
});
