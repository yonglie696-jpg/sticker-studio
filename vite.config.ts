import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': API, '/files': API },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
