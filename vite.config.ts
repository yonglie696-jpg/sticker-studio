import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 后端默认只监听 127.0.0.1，这里写死 IPv4，避免 localhost 被解析成 ::1 连不上
const API = `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;

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
