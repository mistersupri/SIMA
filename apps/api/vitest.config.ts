import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Test memakai satu database bersama, jadi file dijalankan berurutan.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
