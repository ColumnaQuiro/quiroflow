// The staff and patient sign-ins share one shell (components/onboarding/
// Layout.vue) and link to each other, and the patient one only asks for the
// clinic code when it does not already know it.
describe('Sign-in: staff and patients through the same door', () => {
  it('links each sign-in to the other', () => {
    cy.visit('/login')
    cy.contains('a', "I'm a patient").should('have.attr', 'href', '/portal/login').click()
    cy.location('pathname').should('eq', '/portal/login')
    cy.contains('h1', 'Patient sign in')
    cy.contains('a', 'Clinic team').should('not.have.attr', 'aria-current')
    cy.contains('a', 'Clinic team').click()
    cy.location('pathname').should('eq', '/login')
    cy.contains('a', 'Clinic team').should('have.attr', 'aria-current', 'page')
  })

  it('opens in Spanish for a Spanish browser, and the switch changes it', () => {
    cy.visit('/login', {
      onBeforeLoad(win) {
        Object.defineProperty(win.navigator, 'language', { value: 'es-ES' })
        Object.defineProperty(win.navigator, 'languages', { value: ['es-ES', 'es'] })
      },
    })
    cy.contains('h1', 'Inicia sesión')
    cy.contains('button', 'Entrar')
    cy.get('button[aria-label=English]').click()
    cy.contains('h1', 'Sign in')
    // Remembered: the next page opens in the language chosen here.
    cy.visit('/portal/login', {
      onBeforeLoad(win) {
        Object.defineProperty(win.navigator, 'language', { value: 'es-ES' })
      },
    })
    cy.contains('h1', 'Patient sign in')
  })

  it('signs a linked patient in without a clinic code, then remembers the clinic', () => {
    const email = `door-${Date.now()}@example.test`
    const password = 'puerta-2026-x'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Paciente',
        lastName: 'Puerta',
        email,
      }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
      })

      // Nothing known: the code is a field, and leaving it empty is fine for
      // an account already linked to its record.
      cy.visit('/portal/login')
      cy.get('#clinic-code').should('not.have.attr', 'required')
      cy.get('#email').type(email)
      cy.get('#password').type(password)
      cy.contains('button', 'Sign in').click()
      cy.location('pathname', { timeout: 15000 }).should('eq', '/portal')

      // Signed in with the code once, the next visit names the clinic
      // instead of asking for it.
      cy.clearCookies()
      cy.window().then((win) => win.localStorage.setItem('clinic_slug', account.accountSlug))
      cy.visit('/portal/login')
      cy.get('[data-testid=clinic-chip]').should('contain', account.accountName)
      cy.get('#clinic-code').should('not.exist')
      cy.contains('a', 'Create your account').should('have.attr', 'href', `/portal/signup?clinic=${account.accountSlug}`)
    })
  })

  it('offers a resend once a patient has signed up', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('POST', '**/auth/v1/signup*', {
        statusCode: 200,
        body: { id: '00000000-0000-0000-0000-000000000000', email: 'new@example.test', aud: 'authenticated', role: '' },
      })
      cy.visit(`/portal/signup?clinic=${account.accountSlug}`)
      cy.get('[data-testid=clinic-chip]').should('contain', account.accountName)
      cy.get('#email').type('new@example.test')
      cy.get('#password').type('valencia2026')
      cy.contains('button', 'Create account').click()
      cy.contains('h1', 'Check your email')
      cy.contains('new@example.test')
      cy.contains('button', 'Resend link').should('be.disabled')
      cy.contains('You can resend in')
      cy.contains('button', 'use a different email').click()
      cy.get('#email').should('have.value', 'new@example.test')
    })
  })
})
