import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Live-network tests (EXA_LIVE=1 or LLM_LIVE=1) need the keys from .env.
// Every other run stays hermetic and never reads the file.
if ((process.env.EXA_LIVE || process.env.LLM_LIVE) && existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'app/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'evals/**/*.test.ts',
    ],
  },
});
