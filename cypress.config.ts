import { defineConfig } from 'cypress'
import dotenv from 'dotenv'
import { dbTasks } from './cypress/support/tasks/db'

dotenv.config()

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
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
