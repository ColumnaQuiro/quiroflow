describe('Login', () => {
  it('shows an error for invalid credentials', () => {
    cy.visit('/login')
    cy.get('#email').type('nobody@example.test')
    cy.get('#password').type('wrong-password')
    cy.contains('button', 'Sign in').click()
    cy.contains(/invalid|error/i).should('be.visible')
    cy.location('pathname').should('eq', '/login')
  })

  it('logs in and reaches the dashboard', () => {
    cy.seedStaffAccount().then((account) => {
      cy.visit('/login')
      cy.get('#email').type(account.email)
      cy.get('#password').type(account.password)
      cy.contains('button', 'Sign in').click()
      cy.location('pathname', { timeout: 15000 }).should('eq', '/dashboard')
      cy.contains(account.accountName).should('be.visible')
    })
  })

  it('logs out and blocks the dashboard afterwards', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.logout()
      cy.location('pathname', { timeout: 15000 }).should('eq', '/login')
      cy.visit('/dashboard')
      cy.location('pathname', { timeout: 15000 }).should('eq', '/login')
    })
  })
})
