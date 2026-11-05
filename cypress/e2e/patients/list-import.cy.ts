// Importing contacts straight into a list (Patients > Lists > Import, the
// "Other system" importer with a list chosen): people already here are
// matched -- by DNI, by phone when one patient alone has it and the first
// name agrees -- rather than duplicated, and go on the list too. Marketing
// consent is declared by whoever imports and set only on the patients the
// import creates; a patient already here keeps their own.
describe('Import into a list', () => {
  it('imports a CSV into a new list, matching existing patients and giving consent only to new ones', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      // Matched by phone ("+34 600 111 222" in the file) and an accented first name.
      cy.task('db:createPatient', { ...base, firstName: 'Lucía', lastName: 'Existente', phone: '600111222' })
      // Matched by DNI.
      cy.task('db:createPatient', { ...base, firstName: 'Dora', lastName: 'Coincide', nationalId: '12345678Z' })

      cy.login(account.email, account.password)
      cy.visit('/patients?view=lists')
      // Until the page has hydrated a click on the server-rendered button does nothing.
      cy.clickUntil('[data-cy=list-import]', '[data-cy=import-file]')
      cy.location('pathname').should('eq', '/patients/import')

      cy.get('[data-cy=import-file]').selectFile('cypress/fixtures/list-import-contacts.csv', { force: true })
      cy.contains('4 rows detected.', { timeout: 15000 }).should('be.visible')
      cy.get('[data-cy=import-list]').select('New list…')
      cy.get('[data-cy=import-new-list-name]').type('Contactos feria')
      cy.get('[data-cy=import-consent-email]').check()
      cy.get('[data-cy=import-continue]').click()

      cy.contains('dt', 'Will import').next().should('have.text', '2')
      cy.get('[data-cy=import-list-summary]').should('contain', '4 will be on the list “Contactos feria”: 2 new and 2 already here.')
      cy.get('[data-cy=import-consent-kept]').should('contain', '2 of those already here have no marketing consent')
      cy.get('[data-cy=import-run]').click()

      cy.get('[data-cy=import-listed]', { timeout: 20000 }).should('contain', '4 added to the list “Contactos feria”')
      cy.task('db:patientCount', { accountId: account.accountId }).should('eq', 4)

      cy.task<{ id: string } | null>('db:listByName', { accountId: account.accountId, name: 'Contactos feria' }).then((list) => {
        cy.task('db:listMembers', { listId: list!.id }).then((members: any) => {
          expect(members.map((m: any) => m.firstName)).to.deep.equal(['Dora', 'Lucía', 'Nueva', 'Nuevo'])
          expect(members.every((m: any) => m.source === 'import' && m.sourceDetail === 'list-import-contacts.csv')).to.equal(true)
        })
      })
      // Consent: the new row that said yes has it, the one that said no has
      // not, and the matched patient is left as they were.
      cy.task<{ id: string }>('db:patientByName', { accountId: account.accountId, firstName: 'Nuevo', lastName: 'Uno' }).then((p) => {
        cy.task('db:patientMarketing', { patientId: p.id }).should('deep.equal', ['email'])
      })
      cy.task<{ id: string }>('db:patientByName', { accountId: account.accountId, firstName: 'Nueva', lastName: 'Dos' }).then((p) => {
        cy.task('db:patientMarketing', { patientId: p.id }).should('deep.equal', [])
      })
      cy.task<{ id: string }>('db:patientByName', { accountId: account.accountId, firstName: 'Lucía', lastName: 'Existente' }).then((p) => {
        cy.task('db:patientMarketing', { patientId: p.id }).should('deep.equal', [])
      })

      // Open it from the result: the patient list, filtered to the four.
      cy.get('[data-cy=import-open-list]').click()
      cy.get('[data-cy=list-header]', { timeout: 15000 }).should('contain', 'Contactos feria')
      cy.contains('4 patients').should('be.visible')
    })
  })

  it('imports an Excel file into the list it was opened from', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/patients?view=lists')
      cy.clickUntil('[data-cy=list-create]', '[data-cy=segment-name]')
      cy.get('[data-cy=segment-name]').type('Newsletter')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=list-row]', 'Newsletter').find('[data-cy=list-row-import]').click()

      cy.get('[data-cy=import-file]').selectFile('cypress/fixtures/list-import-contacts.xlsx', { force: true })
      cy.contains('2 rows detected.', { timeout: 15000 }).should('be.visible')
      cy.get('[data-cy=import-list]').find('option:selected').should('have.text', 'Newsletter')
      cy.get('[data-cy=import-continue]').click()
      cy.get('[data-cy=import-list-summary]').should('contain', '2 will be on the list “Newsletter”')
      cy.get('[data-cy=import-run]').click()
      cy.get('[data-cy=import-listed]', { timeout: 20000 }).should('contain', '2 added to the list “Newsletter”')

      cy.get('[data-cy=import-open-list]').click()
      cy.contains('2 patients', { timeout: 15000 }).should('be.visible')
      cy.contains('a', 'Hoja Primera').should('be.visible')
      cy.contains('a', 'Hoja Segunda').should('be.visible')
    })
  })
})
