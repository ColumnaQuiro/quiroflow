// A bono's remaining value lives on its sessions counter, not in
// account_credits (0161). The pill by the patient's name read account_credits
// alone, so a patient with ten prepaid sessions in hand showed nothing at all
// -- and it went blank for essentially every bono holder in the account the
// day that migration ran.
//
// It has to read as money because that is the question reception is asked
// ("how much do I have left?") and because PracticeHub, which the clinic is
// still dual-running against, shows the same figure in its `balance` column.
describe('The credit pill', () => {
  it('shows what the unused bono sessions are worth', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruna', lastName: 'Bonovalue' }).then((patient: any) => {
        // 12 sessions at €528 => €44 each; 6 taken leaves 6 x €44 = €264,
        // the same number PracticeHub derives for this bono.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 6,
          priceCents: 52800,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('€264.00 in bonos').should('be.visible')
        cy.contains('dt', 'In bonos').parent().should('contain', '€264.00')
      })
    })
  })

  it('does not count a fully-used bono, and stays hidden when there is nothing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Spent', lastName: 'Allup' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 12',
          sessionsTotal: 12,
          sessionsUsed: 12,
          priceCents: 52800,
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.contains('dt', 'In bonos').parent().should('contain', '€0.00')
        cy.contains('in bonos').should('not.exist')
        cy.contains('Credit').should('exist')
      })
    })
  })
})
