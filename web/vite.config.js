import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:9822', '/webhook': 'http://localhost:9822' } },
  build: { target: 'es2020', cssCodeSplit: true, chunkSizeWarningLimit: 900 },
});
