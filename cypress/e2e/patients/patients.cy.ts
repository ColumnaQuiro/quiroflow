describe('Patients', () => {
  it('creates a patient and lands on their detail page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/patients')
      // First click after a fresh visit can race Vue hydration (see commands.ts clickUntil).
      cy.clickUntil('button:contains("New patient")', '#first-name')

      cy.get('#first-name').type('Jane')
      cy.get('#last-name').type('Doe')
      cy.get('#dob').type('1990-05-15')
      cy.get('#email').type('jane.doe@example.test')
      cy.get('#tags').type('vip, referral')
      cy.contains('button', 'Add Patient').click()

      cy.location('pathname', { timeout: 15000 }).should('match', /^\/patients\/[0-9a-f-]+$/)
      cy.contains('Jane Doe').should('be.visible')
    })
  })

  it('lists a seeded patient and lets you open it from the table', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Bob',
        lastName: 'Smith',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit('/patients')
        cy.contains('Bob Smith').click()
        cy.location('pathname', { timeout: 15000 }).should('eq', `/patients/${patient.id}`)
      })
    })
  })

  it('smoke-tests every patient detail tab', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Carol',
        lastName: 'White',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        for (const tab of ['overview', 'clinical', 'appointments', 'money', 'communications', 'attachments']) {
          cy.visit(`/patients/${patient.id}?tab=${tab}`)
          cy.contains('Carol White').should('be.visible')
        }

        // The tabs were renamed and two of them merged. The old names are in
        // bookmarks and in links this app builds itself, so each one still
        // has to land on the tab that absorbed it rather than silently
        // falling back to Overview -- which would look like the record had
        // lost its billing.
        const legacy: Record<string, string> = {
          'visit-notes': 'Clinical',
          billing: 'Money',
          docs: 'Attachments',
          files: 'Attachments',
        }
        for (const [old, label] of Object.entries(legacy)) {
          cy.visit(`/patients/${patient.id}?tab=${old}`)
          cy.contains('button', label).should('have.attr', 'aria-current', 'page')
        }
      })
    })
  })
})
