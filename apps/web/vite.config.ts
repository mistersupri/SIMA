import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Satu .env di root monorepo dipakai bersama oleh API dan web.
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = env.API_PORT ?? '3001';
  const webPort = Number(env.WEB_PORT ?? 5173);

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      port: webPort,
      host: true,
      strictPort: true,
      proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } },
    },
    preview: { port: webPort, proxy: { '/api': { target: `http://localhost:${apiPort}` } } },
  };
});
