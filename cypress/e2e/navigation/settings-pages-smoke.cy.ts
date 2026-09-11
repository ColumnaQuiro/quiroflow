import { SETTINGS_PAGES, sweepAuthenticatedPages } from '../../support/pageInventory'

// The other authenticated sweep. Split from the app-page one purely so no
// single spec dominates a CI shard -- together they were 90s in one file,
// which capped how far the suite could usefully shard however many runners
// were thrown at it.
describe('Every authenticated settings page renders for the account owner', () => {
  it('smoke-tests every page under /settings', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      sweepAuthenticatedPages(SETTINGS_PAGES)
    })
  })
})
