describe('CSV patient import (PracticeHub)', () => {
  it('previews and imports patients from a CSV file', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // /settings/import now defaults to the PracticeHub "General" tab
      // (saved-connection settings), not "Patients" -- the importer that
      // fetches team_members and renders a file input only mounts once
      // the "Patients" data-type pill is selected.
      cy.intercept('GET', '**/rest/v1/team_members*').as('teamMembersFetch')
      cy.visit('/settings/import')
      cy.contains('button', 'Patients').click()
      // The importer's onMounted fetches team_members before it's ready to
      // handle a file drop; selecting a file before that resolves is a
      // silent no-op, so wait for the request rather than a blind delay.
      cy.wait('@teamMembersFetch')

      cy.get('input[type=file]').selectFile('cypress/fixtures/practicehub-patients.csv', { force: true })

      cy.contains('Will import', { timeout: 15000 }).should('be.visible')
      cy.contains('dd', '2').should('be.visible')
      cy.contains('td', 'TestOne').scrollIntoView().should('be.visible')
      cy.contains('td', 'TestTwo').scrollIntoView().should('be.visible')

      cy.contains('button', /Import \d+, update \d+/).click()
      // Exact count, not just /Imported \d+ patients\./ -- that regex is
      // satisfied just as well by "Imported 0 patients." if every row
      // silently failed to insert, which would otherwise pass this
      // assertion and only surface as a confusing failure two steps later.
      cy.contains('Imported 2 patients.', { timeout: 15000 }).scrollIntoView().should('be.visible')

      cy.visit('/patients')
      cy.contains('Import TestOne').should('be.visible')
      cy.contains('Import TestTwo').should('be.visible')
    })
  })
})
