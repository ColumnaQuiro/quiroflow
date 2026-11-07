// A failed read on the patient record is said as a failure, never as an
// answer.
//
// supabase-js hands back { data: null, error } instead of throwing, so a
// dropped connection used to leave the record on its skeleton forever, and
// the Overview cards said "Nothing booked.", left "Needs attention" out and
// claimed "No plan set up" -- three confident statements about a patient,
// all false. A record that is really not there says so, with a way back.
describe('The patient record when a read fails', () => {
  it('offers to try again when the record itself fails to load', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Fermina',
        lastName: 'Reintento',
      }).then((patient: any) => {
        let failing = true
        cy.intercept('GET', `**/rest/v1/patients?*id=eq.${patient.id}*`, (req) => {
          if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('[data-cy=patient-load-error]', { timeout: 20000 }).should('contain', "Couldn't open this record")
        cy.contains('Patient not found').should('not.exist')

        cy.then(() => {
          failing = false
        })
        cy.get('[data-cy=patient-load-retry]').click()
        cy.contains('h1', 'Fermina Reintento').should('be.visible')
      })
    })
  })

  it('says which Overview card could not be checked, and recovers on retry', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Teodora',
        lastName: 'Tarjetas',
      }).then((patient: any) => {
        let failing = true
        for (const table of ['appointments', 'care_plans', 'invoices']) {
          cy.intercept('GET', `**/rest/v1/${table}?*patient_id=eq.${patient.id}*`, (req) => {
            if (failing) req.reply({ statusCode: 500, body: { message: 'failed' } })
          })
        }
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('[data-cy=overview-next-failed]', { timeout: 20000 }).should('be.visible')
        cy.get('[data-cy=overview-plan-failed]').should('be.visible')
        cy.get('[data-cy=overview-attention-failed]').should('be.visible')
        // The answers a failed read used to give.
        cy.contains('Nothing booked.').should('not.exist')
        cy.contains('No plan set up for this patient yet.').should('not.exist')

        cy.then(() => {
          failing = false
        })
        cy.get('[data-cy=overview-next-failed]').contains('button', 'Try again').click()
        cy.contains('Nothing booked.').should('be.visible')
        cy.contains('No plan set up for this patient yet.').should('be.visible')
        cy.get('[data-cy=overview-attention-failed]').should('not.exist')
      })
    })
  })

  it('says a missing record is missing, with a way back to the list', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/patients/00000000-0000-4000-8000-000000000000')
      cy.get('[data-cy=patient-not-found]').should('contain', 'Patient not found')
      cy.get('[data-cy=patient-not-found]').contains('button', 'Back to patients').click()
      cy.location('pathname').should('eq', '/patients')
    })
  })
})
