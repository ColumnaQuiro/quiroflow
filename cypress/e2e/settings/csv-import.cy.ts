describe('CSV patient import (PracticeHub)', () => {
  it('previews and imports patients from a CSV file', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // The importer's onMounted fetches team_members before it's ready to
      // handle a file drop; selecting a file before that resolves is a
      // silent no-op, so wait for the request rather than a blind delay.
      cy.intercept('GET', '**/rest/v1/team_members*').as('teamMembersFetch')
      cy.visit('/settings/import')
      cy.wait('@teamMembersFetch')

      cy.contains('Patients').should('be.visible')
      cy.get('input[type=file]').selectFile('cypress/fixtures/practicehub-patients.csv', { force: true })

      cy.contains('Will import', { timeout: 15000 }).should('be.visible')
      cy.contains('dd', '2').should('be.visible')
      cy.contains('td', 'TestOne').scrollIntoView().should('be.visible')
      cy.contains('td', 'TestTwo').scrollIntoView().should('be.visible')

      cy.contains('button', /Import \d+ patients/).click()
      cy.contains(/Imported \d+ patients\./, { timeout: 15000 }).should('be.visible')

      cy.visit('/patients')
      cy.contains('Import TestOne').should('be.visible')
      cy.contains('Import TestTwo').should('be.visible')
    })
  })
})
