// An invite the database refuses must not be thrown away.
//
// The usual way a colleague joins is: open the invite link, sign up, confirm
// the email. The confirmation breaks the ?token= chain, so the token waits in
// localStorage and the account middleware accepts it on the next page load.
// When that accept failed -- the practice had no free practitioner seat,
// most often -- the middleware deleted the token and let its own "no
// practice yet" redirect send the colleague to onboarding, to create a clinic
// of their own. Nothing said why. Anyone who went along with it ended up in a
// second, separate account while the owner wondered why nobody had joined.
//
// Paid Solo throughout: an open free trial has no seat cap to refuse with
// (20260924100032), and a paying one-practitioner plan with the owner in its
// seat is exactly where the refusal still happens.

describe('An invite the practice has no seat for', () => {
  function setup() {
    return cy.seedStaffAccount().then((account) => {
      cy.setSubscriptionStatus(account.accountId, 'active')
      const email = `invitee-${Date.now()}@example.test`
      return cy.task<{ token: string }>('db:createInvite', { accountId: account.accountId, email }).then(({ token }) =>
        cy.task('db:createLoneUser', { email, password: 'Test1234!' }).then(() => ({ account, email, token })),
      )
    })
  }

  it('sends the colleague to /join to be told why, not to onboarding to start a clinic of their own', () => {
    setup().then(({ email, token }) => {
      cy.login(email, 'Test1234!')
      // Where the confirmation link leaves them: signed in, token pending.
      cy.visit('/login', {
        onBeforeLoad(win) {
          win.localStorage.setItem('pending_invite_token', token)
        },
      })
      cy.visit('/dashboard')

      cy.location('pathname').should('eq', '/join')
      // Written for the person invited, who has no Subscription page -- not
      // the trigger's own "add a seat on the Subscription page".
      cy.contains("This practice's plan has no free practitioner seat").should('be.visible')
      cy.contains('Ask the person who invited you to add a seat').should('be.visible')
      cy.window().its('localStorage').invoke('getItem', 'pending_invite_token').should('eq', token)
    })
  })

  it('joins them once the owner has made room, from the same link', () => {
    setup().then(({ account, email, token }) => {
      cy.login(email, 'Test1234!')
      cy.visit(`/join?token=${token}`)
      cy.contains("This practice's plan has no free practitioner seat").should('be.visible')

      cy.setExtraProfessionals(account.accountId, 1)
      cy.visit(`/join?token=${token}`)
      cy.location('pathname').should('eq', '/dashboard')
    })
  })

  it('still leaves a way out for someone who would rather start their own practice', () => {
    setup().then(({ email, token }) => {
      cy.login(email, 'Test1234!')
      cy.visit(`/join?token=${token}`)
      cy.get('[data-test="join-start-own-practice"]').click()

      cy.location('pathname').should('eq', '/onboarding')
      cy.window().its('localStorage').invoke('getItem', 'pending_invite_token').should('be.null')
    })
  })
})
