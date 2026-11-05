import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      AUTO_SEED: 'false',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/database/seed.ts'],
      reporter: ['text', 'html'],
    },
  },
});
