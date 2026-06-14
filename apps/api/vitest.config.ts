import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Ledger tests share one Postgres instance; run files sequentially so isolation
    // is governed by SQL transactions, not by parallel test workers.
    fileParallelism: false,
  },
});
