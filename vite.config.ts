import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // MapLibre charge son worker par une URL relative à son fichier : le pré-bundling la casse.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 5174}` },
  },
  test: { include: ['shared/**/*.test.ts', 'server/**/*.test.ts'] },
});
