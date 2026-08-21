import { defineConfig } from 'cypress'
import dotenv from 'dotenv'
import { dbTasks } from './cypress/support/tasks/db'

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
      on('task', dbTasks)
      return config
    },
  },
  retries: {
    runMode: 2,
    openMode: 0,
  },
  video: false,
})
