// "Sign out" from the account menu, from the page an owner lands on.
//
// The second test is the production failure. @nuxtjs/supabase keeps its own
// copy of the user (useSupabaseUser()), filled by getClaims() calls it never
// cancels, so one that resolves after signOut() puts the old claims back. With
// those in place middleware/account.global.ts thought someone was signed in:
// no team member under an anonymous client sent /login to /onboarding, the
// module's redirect sent /onboarding (no session) back to /login, and that
// loop never settled -- the page sat on /dashboard, emptied by store.reset(),
// greeting nobody. The late write is reproduced here at the start of the
// /login navigation, which is the latest point it can land and still matter.
describe('Sign out', () => {
  function signInToDashboard() {
    return cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      // The dashboard has loaded the account: the state sign-out starts from.
      cy.contains(account.accountName).should('be.visible')
      return cy.wrap(account)
    })
  }

  function expectSignInForm() {
    cy.location('pathname', { timeout: 15000 }).should('eq', '/login')
    cy.get('#email').should('be.visible')
    cy.get('#password').should('be.visible')
    cy.contains('button', 'Sign in').should('be.visible')
    cy.contains('No figures on your dashboard').should('not.exist')
  }

  it('signs an owner out from the dashboard and lands on the sign-in form', () => {
    signInToDashboard()
    cy.logout()
    expectSignInForm()
  })

  it('still lands on the sign-in form when the old claims come back after sign-out', () => {
    signInToDashboard()
    cy.get('#__nuxt')
      .should(($root) => {
        expect(($root[0] as any).__vue_app__?.$nuxt, 'hydrated Nuxt app').to.exist
      })
      .then(($root) => {
        const nuxtApp = ($root[0] as any).__vue_app__.$nuxt
        // useState('supabase_user') -- Nuxt keys useState entries with '$s'.
        const state = nuxtApp.payload.state
        const claims = state.$ssupabase_user
        expect(claims, 'claims before sign-out').to.have.property('sub')
        let pending = true
        nuxtApp.$supabase.client.auth.onAuthStateChange((event: string) => {
          if (event !== 'SIGNED_OUT' || !pending) return
          // The next navigation is the one to /login.
          nuxtApp.hook('page:loading:start', () => {
            if (!pending) return
            pending = false
            state.$ssupabase_user = claims
          })
        })
      })
    cy.logout()
    expectSignInForm()
  })
})
