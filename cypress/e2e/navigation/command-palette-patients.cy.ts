// The search in the top bar (AppCommandPalette). It listed patients by name
// alone, so two people with the same name were two identical rows. Each now
// carries what the front desk asks to tell them apart: date of birth, a phone,
// and whether the record is inactive.

describe('Patients in the top-bar search', () => {
  it('tells two patients with the same name apart', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'María', lastName: 'García', dateOfBirth: '1985-03-12', phone: '612345678' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'María', lastName: 'García', dateOfBirth: '1962-11-30' }).then((older) => {
        cy.task('db:updateRows', { table: 'patients', match: { id: older.id }, values: { status: 'inactive' } })
      })

      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      // Rendered on the server: a click before hydration does nothing.
      cy.clickUntil('button[title^="Search or jump to"]', '[role=dialog] input')
      cy.get('[role=dialog] input').type('maria garcia')
      cy.get('[data-cy=palette-patient]').should('have.length', 2)
      cy.get('[data-cy=palette-patient-detail]').then(($d) => {
        const details = [...$d].map((el) => el.textContent?.trim()).sort()
        expect(details).to.deep.equal(['12 Mar 1985 · +34 612345678', '30 Nov 1962 · Inactive'])
      })
    })
  })
})
