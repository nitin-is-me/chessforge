import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'shared'),
      '@': path.resolve(import.meta.dirname, 'client/src'),
    },
  },
  optimizeDeps: {
    include: ['chess.js'],
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
    // Ensure react is not externalized
    commonjsOptions: {
      exclude: ['react', 'react-dom'],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
