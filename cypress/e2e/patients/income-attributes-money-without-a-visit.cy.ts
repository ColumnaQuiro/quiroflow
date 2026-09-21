// Income filtered by practitioner could only see money from visits.
//
// The chain was payment -> invoice -> appointment -> practitioner, and
// anything off it belonged to nobody. Filtering September by Jordana Aguar
// showed €849 while the clinic had taken €9,976 — the other €9,057 was bono
// payments, money on account and quick invoices, none of which has an
// appointment behind it, so all of it silently vanished from every
// practitioner's figure.
//
// Now the patient's own practitioner answers when the visit cannot.
describe('Income filtered by practitioner', () => {
  it('counts a bono payment through the patient, not just visits', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Bono',
        lastName: 'Sinvisita',
        defaultPractitionerId: account.teamMemberId,
      }).then((patient: any) => {
        // €200 on account: a payment with no invoice and so no appointment —
        // exactly the shape that used to be invisible.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 20000, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')

        // Unfiltered it was always counted.
        cy.contains('200,00 €').should('be.visible')

        // Filtered to the practitioner it now still is, via the patient.
        cy.contains('select', 'All practitioners').select('Test Owner')
        cy.contains('200,00 €').should('be.visible')
      })
    })
  })

  it('names what it cannot attribute instead of dropping it', () => {
    cy.seedStaffAccount().then((account) => {
      // No practitioner on the patient, no appointment on the money: nothing
      // says whose this is. Claiming it belongs to nobody is right; hiding it
      // is what made the totals stop reconciling.
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nadie', lastName: 'Atribuible' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 7500, method: 'cash' })

        cy.login(account.email, account.password)
        cy.visit('/reports/income')
        cy.contains('Total paid').should('be.visible')
        cy.contains('no filter can attribute').should('not.exist')

        cy.contains('select', 'All practitioners').select('Test Owner')
        cy.contains('75,00 €').should('be.visible')
        cy.contains('no filter can attribute').should('be.visible')
      })
    })
  })
})
