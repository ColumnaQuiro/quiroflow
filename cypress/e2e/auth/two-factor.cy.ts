// Two-factor login: an authenticator-app code after the password, set up by
// each person on their own login and optionally required by the clinic.
//
// The app's redirect is only half of it. The other half is the database
// refusing a password-only session, which is what actually stops a stolen
// password -- so that is asserted directly against PostgREST, with no app in
// the way, not inferred from what the page shows.
describe('Two-factor login', () => {
  function readSecret() {
    return cy.get('[data-testid="two-factor-secret"]', { timeout: 15000 }).invoke('attr', 'data-secret').then((secret) => {
      expect(secret, 'TOTP secret').to.match(/^[A-Z2-7]+=*$/)
      return secret as string
    })
  }

  it('asks for the code after the password once set up, and a password alone reads nothing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      // Requiring it for the team is refused until your own login uses it.
      cy.visit('/settings/team')
      cy.get('[data-testid="require-two-factor"]').within(() => {
        cy.contains('Set up two-factor on your own login first').should('be.visible')
        cy.get('[role="switch"]').should('be.disabled')
      })

      cy.visit('/account')
      // Interactive once mounted, and further down the page than it was.
      cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-testid="two-factor-card"]').scrollIntoView().within(() => {
        cy.contains('Off').should('be.visible')
        cy.contains('button', 'Set up two-factor').click()
      })
      readSecret().then((secret) => {
        cy.task<string>('totp:code', { secret }).then((enrollCode) => {
          cy.get('#two-factor-enroll-code').type(enrollCode)
          cy.contains('button', 'Turn on two-factor').click()
          cy.get('[data-testid="two-factor-card"]').contains('On').should('be.visible')

          // The database, not the redirect: a fresh password-only session
          // sees no team, no clinics, and an empty bootstrap.
          cy.task('db:passwordOnlyReads', { email: account.email, password: account.password }).then((reads: any) => {
            expect(reads.gate).to.equal('verify')
            expect(reads.teamMembers).to.equal(0)
            expect(reads.clinics).to.equal(0)
            expect(reads.bootstrapTeamMember).to.equal(null)
          })

          // Now this session has passed two-factor, the switch is live.
          cy.visit('/settings/team')
          cy.get('[data-testid="require-two-factor"] [role="switch"]').should('not.be.disabled').click()
          cy.get('[data-testid="require-two-factor"] [role="switch"]').should('have.attr', 'aria-checked', 'true')

          // A real sign-in through the form now stops at the code.
          cy.clearCookies()
          cy.clearLocalStorage()
          cy.visit('/login')
          cy.get('#email').type(account.email)
          cy.get('#password').type(account.password)
          cy.contains('button', 'Sign in').click()
          cy.location('pathname', { timeout: 15000 }).should('eq', '/two-factor')
          cy.contains('Two-factor authentication').should('be.visible')

          cy.get('#two-factor-code').type('000000')
          cy.contains("That code didn't work").should('be.visible')
          cy.location('pathname').should('eq', '/two-factor')

          cy.task<string>('totp:code', { secret, notCode: enrollCode }, { timeout: 45000 }).then((loginCode) => {
            cy.get('#two-factor-code').type(loginCode)
          })
          cy.location('pathname', { timeout: 30000 }).should('eq', '/dashboard')
          cy.contains(account.accountName, { timeout: 15000 }).should('be.visible')

          // Required by the clinic, so it cannot be switched off from here.
          cy.visit('/account')
          cy.get('[data-cy=account-page]').should('have.attr', 'data-ready', 'true')
          cy.get('[data-testid="two-factor-card"]').scrollIntoView().within(() => {
            cy.contains('Your clinic requires two-factor authentication').should('be.visible')
            cy.contains('button', 'Turn off').should('not.exist')
          })
        })
      })
    })
  })

  it('a clinic that requires it sends a member without it to set it up before anything loads', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRequireTwoFactor', { accountId: account.accountId, required: true })

      cy.task('db:passwordOnlyReads', { email: account.email, password: account.password }).then((reads: any) => {
        expect(reads.gate).to.equal('enroll')
        expect(reads.teamMembers).to.equal(0)
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.location('pathname', { timeout: 15000 }).should('eq', '/two-factor')
      cy.location('search').should((search) => expect(new URLSearchParams(search).get('next')).to.equal('/patients'))
      cy.contains('Set up two-factor authentication').should('be.visible')
      // Required, so there is no way to skip it.
      cy.contains('button', 'Cancel').should('not.exist')

      readSecret().then((secret) => {
        cy.task<string>('totp:code', { secret }).then((code) => cy.get('#two-factor-enroll-code').type(code))
      })
      cy.contains('button', 'Turn on two-factor').click()
      cy.location('pathname', { timeout: 30000 }).should('eq', '/patients')
    })
  })
})
