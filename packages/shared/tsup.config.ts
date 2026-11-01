import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  // Mode watch tidak membersihkan dist: API mungkin sedang mengimpornya saat startup.
  clean: !options.watch,
  sourcemap: true,
}));
