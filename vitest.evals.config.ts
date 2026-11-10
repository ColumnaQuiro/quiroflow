import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Behaviour evals for the AI receptionist (tests/evals/receptionist): real
// conversations, invented people, run against the real model. Not unit
// tests -- they cost money and the model is not deterministic -- so they are
// kept out of `npm run test:unit` and CI, and run by hand with
// `npm run eval:receptionist` before a change to the prompt or the rules.
export default defineConfig({
  esbuild: { tsconfigRaw: '{}' },
  resolve: {
    alias: { '~': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['tests/evals/**/*.eval.ts'],
    setupFiles: ['tests/evals/setup.ts'],
    environment: 'node',
    testTimeout: 180_000,
    // One conversation at a time: each makes several model calls.
    fileParallelism: false,
  },
})
