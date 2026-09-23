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
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
