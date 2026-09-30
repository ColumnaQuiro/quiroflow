import { defineConfig } from 'cypress'
import dotenv from 'dotenv'
import { dbTasks } from './cypress/support/tasks/db'
import { routeTasks } from './cypress/support/tasks/routes'
import { pdfTasks } from './cypress/support/tasks/pdf'
import { automationTasks } from './cypress/support/tasks/automations'

dotenv.config()

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    // Default (1000x660) is narrower than any real desktop use of this app
    // and is too narrow for the Calendar page's grid to fit without
    // horizontal scroll now that it has a persistent mini-calendar +
    // settings rail alongside it.
    viewportWidth: 1440,
    viewportHeight: 900,
    setupNodeEvents(on, config) {
      on('task', { ...dbTasks, ...routeTasks, ...pdfTasks, ...automationTasks })
      return config
    },
  },
  retries: {
    runMode: 2,
    openMode: 0,
  },
  video: false,
  // The growth-automations shard crashed Electron (exit 139, a segfault) at
  // the start of its 8th spec on #504 and again on #508 -- no test failing,
  // the renderer dying after seven specs in one browser. Cypress keeps every
  // test's DOM snapshots in memory for the time-travel debugger, which
  // nobody sees in a headless run; these two free them between tests and
  // collect garbage more eagerly.
  // Only in CI: `cypress open` keeps its debugger history.
  numTestsKeptInMemory: process.env.CI ? 0 : 50,
  experimentalMemoryManagement: true,
})
