import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Paket workspace di-bundle; dependensi lain tetap di node_modules.
  noExternal: ['@sima/shared'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
