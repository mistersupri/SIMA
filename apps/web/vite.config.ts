import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Satu .env di root monorepo dipakai bersama oleh API dan web.
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const apiPort = env.API_PORT ?? '3001';
  const webPort = Number(env.WEB_PORT ?? 5173);

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          name: 'SIMA, Sistem Informasi Manajemen Inventaris Barang',
          short_name: 'SIMA',
          description: 'Inventaris barang, persediaan, dan stock opname dengan pemindaian QR.',
          lang: 'id',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#172554',
          background_color: '#F8FAFC',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Hanya shell aplikasi (JS/CSS/font/ikon) yang di-cache. Data API dan file privat TIDAK pernah di-cache.
          globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
        },
      }),
    ],
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
