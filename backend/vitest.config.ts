import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'src/server.ts',
        'scripts/**',
        'migrations/**',
      ],
      include: ['src/**/*.ts'],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@jest/globals': path.resolve(__dirname, './tests/jest-globals-shim.ts'),
      'node:test': path.resolve(__dirname, './tests/node-test-shim.ts'),
    },
  },
});
