import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    sourcemap: false,
    target: 'es2020',
    // React and the router change rarely: a separate chunk keeps them cached across app releases.
    rollupOptions: { output: { manualChunks: (id: string) => (id.indexOf('node_modules') >= 0 ? 'vendor' : undefined) } }
  }
});
