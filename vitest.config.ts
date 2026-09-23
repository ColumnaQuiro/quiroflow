import { defineConfig } from 'vitest/config'

// Unit tests: code that needs no browser, no database and no server.
//
// These lived under cypress/e2e until 2026-09-23. Cypress ran them in a real
// browser against a running app and database, and paid its ~2s per-spec
// startup for each file even when every test in it finished in under half a
// second. Here they run in the typecheck job, inside `npm run preflight`, in
// a second or two.
//
// The rule for what belongs here rather than in Cypress: nothing from `cy`,
// and imports from utils/ (or libraries) only -- plain modules with no Nuxt
// auto-imports. Anything that needs the database (cy.task), the server
// (cy.request) or a page stays an e2e spec.
export default defineConfig({
  // Compile TypeScript without reading the root tsconfig.json. That file
  // extends .nuxt/tsconfig.json, which only exists once `nuxt prepare` has
  // run -- and in CI that happens as npm ci's postinstall, which a
  // node_modules cache hit skips. Every test file then failed to load with
  // "failed to resolve extends ./.nuxt/tsconfig.json" (the same trap #395
  // fixed for Cypress). These tests import plain modules from utils/ and need
  // none of Nuxt's paths or types, so there is nothing to read. A string,
  // not an object: an object is merged with the file, which still reads it.
  esbuild: {
    tsconfigRaw: '{}',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
