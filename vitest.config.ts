import { defineConfig } from 'vitest/config';
import path from 'path';

// Standalone test config: Vitest does not merge `vite.config.ts` when a
// dedicated config file exists, so the `@` alias is declared here as well.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.test.{ts,tsx}', 'db/**/*.test.{ts,tsx}'],
    globals: false,
  },
});
