/// <reference types="cypress" />

export interface StaffAccount {
  email: string
  password: string
  userId: string
  accountId: string
  accountSlug: string
  accountName: string
  clinicId: string
  teamMemberId: string
  roles: { id: string; name: string }[]
}

/** Note: cy.session() always leaves the browser on a blank page afterward -- always cy.visit() next. */
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session(
    [email, password],
    () => {
      cy.visit('/login')
      cy.get('#email').type(email)
      cy.get('#password').type(password)
      cy.contains('button', 'Sign in').click()
      cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
    },
    {
      validate() {
        cy.visit('/dashboard')
        cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
      },
    },
  )
})

Cypress.Commands.add('portalLogin', (email: string, password: string) => {
  cy.session(
    ['portal', email, password],
    () => {
      cy.visit('/portal/login')
      cy.get('#email').type(email)
      cy.get('#password').type(password)
      cy.contains('button', 'Sign in').click()
      cy.location('pathname', { timeout: 15000 }).should('eq', '/portal')
    },
  )
})

/**
 * Nuxt SSR pages render their full HTML (including button text) before Vue
 * hydrates and attaches click handlers. A click that lands in that window is
 * a silent no-op -- the element exists but nothing is listening yet. Rather
 * than a blind wait, this retries the click until `untilSelector` appears,
 * which self-heals regardless of how long hydration actually takes.
 */
Cypress.Commands.add('clickUntil', (clickSelector: string, untilSelector: string, attempt = 0) => {
  cy.get(clickSelector).click()
  cy.get('body').then(($body) => {
    if ($body.find(untilSelector).length === 0) {
      if (attempt >= 10) throw new Error(`clickUntil: "${untilSelector}" never appeared after clicking "${clickSelector}"`)
      cy.wait(200)
      cy.clickUntil(clickSelector, untilSelector, attempt + 1)
    }
  })
})

Cypress.Commands.add('logout', () => {
  cy.clickUntil('[data-testid="account-menu-trigger"]', 'button:contains("Sign out")')
  cy.contains('button', /sign out/i).click()
})

Cypress.Commands.add('seedStaffAccount', (overrides: Partial<{
  email: string
  password: string
  accountName: string
  clinicName: string
  ownerName: string
}> = {}) => {
  const stamp = Date.now() + '-' + Math.floor(Math.random() * 100000)
  const payload = {
    email: overrides.email ?? `owner-${stamp}@example.test`,
    password: overrides.password ?? 'Test1234!',
    accountName: overrides.accountName ?? `Test Clinic ${stamp}`,
    clinicName: overrides.clinicName ?? 'Main Location',
    ownerName: overrides.ownerName ?? 'Test Owner',
  }
  return cy.task<StaffAccount>('db:createStaffAccount', payload)
})

Cypress.Commands.add('setSubscriptionStatus', (accountId: string, status: 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled') => {
  return cy.task('db:setSubscriptionStatus', { accountId, status })
})

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>
      portalLogin(email: string, password: string): Chainable<void>
      logout(): Chainable<void>
      clickUntil(clickSelector: string, untilSelector: string, attempt?: number): Chainable<void>
      seedStaffAccount(
        overrides?: Partial<{
          email: string
          password: string
          accountName: string
          clinicName: string
          ownerName: string
        }>,
      ): Chainable<StaffAccount>
      setSubscriptionStatus(accountId: string, status: 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled'): Chainable<void>
    }
  }
}
