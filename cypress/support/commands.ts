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

/**
 * Signs in through the app's own Supabase client rather than the login form.
 *
 * The form route cost two full SSR loads of /dashboard per call -- the
 * redirect after submit, then the same page again to validate the session --
 * before the test had visited the page it was actually about. At 200+ calls
 * across the suite, most for a freshly created user so cy.session's cache
 * never hits, that was minutes of every CI run spent rendering a dashboard
 * no spec looked at. auth/login.cy.ts is what tests the form itself.
 *
 * The client is the one /login uses (pages/login.vue calls exactly this), so
 * the cookies come out named and encoded exactly as a real sign-in writes
 * them. Minting them in Node instead would mean guessing the cookie name,
 * which @nuxtjs/supabase derives from the Supabase URL at BUILD time -- and CI
 * builds with no URL at all.
 *
 * Note: cy.session() always leaves the browser on a blank page afterward --
 * always cy.visit() next.
 */
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.session(
    [email, password],
    () => {
      cy.visit('/login')
      // Hydrated, i.e. the Nuxt app and its plugins exist on the page.
      cy.get('#__nuxt')
        .should(($root) => {
          expect(($root[0] as any).__vue_app__?.$nuxt?.$supabase?.client, 'Nuxt Supabase client').to.exist
        })
        .then(async ($root) => {
          const { client } = ($root[0] as any).__vue_app__.$nuxt.$supabase
          const { error } = await client.auth.signInWithPassword({ email, password })
          if (error) throw new Error(`cy.login(${email}) failed: ${error.message}`)
        })
    },
    {
      validate() {
        cy.getCookies().should((cookies) => {
          expect(cookies.some((c) => c.name.includes('auth-token')), 'Supabase auth cookie').to.equal(true)
        })
      },
    },
  )
})

Cypress.Commands.add('portalLogin', (email: string, password: string, clinicCode: string) => {
  cy.session(
    ['portal', email, password, clinicCode],
    () => {
      cy.visit('/portal/login')
      // The clinic code is what scopes claim_patient_profile() to one
      // practice -- see composables/useClinicCode.ts.
      cy.get('#clinic-code').type(clinicCode)
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
  // Seeded accounts get the Growth add-on. Every /api/growth/* route now
  // checks the entitlement server-side, so without this every Growth spec
  // would 402 -- and a suite that has to opt in to the product it is testing
  // is one bad default away from testing nothing. Specs that care about NOT
  // having it turn it off explicitly with db:setGrowthAddon.
  return cy.task<StaffAccount>('db:createStaffAccount', payload).then((account) => {
    return cy.task('db:setGrowthAddon', { accountId: account.accountId, enabled: true }).then(() => account)
  })
})

Cypress.Commands.add('setComped', (accountId: string, comped: boolean) => {
  return cy.task('db:setComped', { accountId, comped })
})

Cypress.Commands.add('setSubscriptionStatus', (accountId: string, status: 'trialing' | 'active' | 'past_due' | 'locked' | 'canceled') => {
  return cy.task('db:setSubscriptionStatus', { accountId, status })
})

Cypress.Commands.add('setExtraProfessionals', (accountId: string, extraProfessionals: number) => {
  return cy.task('db:setExtraProfessionals', { accountId, extraProfessionals })
})

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>
      portalLogin(email: string, password: string, clinicCode: string): Chainable<void>
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
      setComped(accountId: string, comped: boolean): Chainable<void>
      setExtraProfessionals(accountId: string, extraProfessionals: number): Chainable<void>
    }
  }
}
