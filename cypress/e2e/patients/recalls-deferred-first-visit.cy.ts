// Someone who cancelled their first visit saying they would book later
// (patients.first_visit_deferred_at, 20261115172804) is on the Recalls list.
//
// Until then the list was keyed on the last visit a patient attended, so
// somebody who had never come had no date to be overdue from and never
// appeared at all: the AI receptionist told them "escríbenos cuando quieras",
// and of 14 such first visits, one person ever booked again.

const DAY = 86400000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString()

describe('Recalls: a first visit put off for later', () => {
  it('lists them, counted from when they said it, and not once they book again', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (firstName: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Aplazada' })
      const visit = (patientId: string, startsAt: string, status: string) =>
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, startsAt, status })

      patient('Diferida').then((deferred) => {
        patient('Cancelada').then((justCancelled) => {
          patient('Rebooked').then((rebooked) => {
            // Said "later" 25 days ago, about a first visit they never had.
            visit(deferred.id, ahead(3), 'cancelled')
            cy.task('db:updateRows', { table: 'patients', values: { first_visit_deferred_at: ago(25) }, match: { id: deferred.id } })
            // Cancelled, gave no reason: nobody to call back, as before.
            visit(justCancelled.id, ahead(3), 'cancelled')
            // Said "later", then booked: off the list like anyone booked.
            visit(rebooked.id, ahead(2), 'cancelled')
            visit(rebooked.id, ahead(10), 'booked')
            cy.task('db:updateRows', { table: 'patients', values: { first_visit_deferred_at: ago(25) }, match: { id: rebooked.id } })

            cy.task<{ rows: Record<string, any>[]; error: string | null }>('db:selectAsStaff', {
              email: account.email,
              password: account.password,
              table: 'recall_candidates',
              columns: 'patient_id, last_appointment_at, days_since_last_appointment, first_visit_deferred_at',
              inColumn: 'patient_id',
              inValues: [deferred.id, justCancelled.id, rebooked.id],
            }).then(({ rows, error }) => {
              expect(error).to.eq(null)
              expect(rows.map((r) => r.patient_id)).to.deep.equal([deferred.id])
              expect(rows[0].last_appointment_at, 'no attended visit is invented').to.eq(null)
              expect(rows[0].days_since_last_appointment).to.be.within(24, 26)
              expect(rows[0].first_visit_deferred_at).to.not.eq(null)
            })

            cy.login(account.email, account.password)
            cy.visit('/recalls')
            cy.contains('a', 'Diferida Aplazada').should('be.visible')
            // A fresh account: the only row is theirs.
            cy.get('[data-cy="recall-first-visit-deferred"]').should('have.length', 1).and('contain.text', 'Cancelled first visit')
            cy.contains('Cancelada Aplazada').should('not.exist')
            cy.contains('Rebooked Aplazada').should('not.exist')
          })
        })
      })
    })
  })
})
