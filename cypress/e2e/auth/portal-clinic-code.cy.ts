// A patient's email is only unique within one clinic, so the portal has to
// be told which clinic it is signing them in to -- claim_patient_profile()
// refuses outright when the same email exists at two practices. The mobile
// app has asked for the code since its /join gate; the web portal didn't
// ask at all, which is what this covers.
describe('The portal sign-in clinic code', () => {
  it('names the clinic when the code is right, and says so when it is not', () => {
    cy.seedStaffAccount().then((account) => {
      cy.visit('/portal/login')

      // Wrong code: the patient finds out here, not several screens later.
      cy.get('#clinic-code').type('no-such-clinic-slug-xyz')
      cy.get('#email').type('someone@example.test')
      cy.get('#password').type('whatever123')
      cy.contains('button', 'Sign in').click()
      cy.contains('Clinic code not found').should('be.visible')
      cy.location('pathname').should('eq', '/portal/login')

      // Right code: the clinic's own name confirms it before any password
      // is handed over.
      cy.get('#clinic-code').clear().type(account.accountSlug).blur()
      cy.contains(account.accountName).should('be.visible')
    })
  })

  it('prefills the code from a clinic link on the sign-up page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.visit(`/portal/signup?clinic=${account.accountSlug}`)
      cy.get('#clinic-code').should('have.value', account.accountSlug)
    })
  })
})
