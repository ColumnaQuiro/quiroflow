import { todayAt } from '../../support/calendar'

// Charging a visit whose type costs 0 € -- a free adjustment, a
// report-of-findings, a talk.
//
// It raised an unpaid 0 € receipt that nothing could settle (there is no 0 €
// payment to take), so it sat in Billing's unpaid list and on the patient's
// visits as "Unpaid · 0,00 €" for good, and the visit was never completed. It
// is now settled as it is raised -- and still takes a product sold at the
// visit, which makes it owed again.

function seedFreeVisit() {
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Free talk', durationMinutes: 30, defaultPriceCents: 0 }).then((type) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Gratis', lastName: 'Charla' }).then((patient) =>
        cy.task('db:createServiceProduct', { accountId: account.accountId, name: 'Pillow', priceCents: 3500 }).then(() =>
          // Checked in, so billable whatever time of day the spec runs.
          cy
            .task<{ id: string }>('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: patient.id,
              practitionerId: account.teamMemberId,
              appointmentTypeId: type.id,
              startsAt: todayAt(10, 0),
              durationMinutes: 30,
              checkedIn: true,
            })
            .then((appt) => ({ account, appt })),
        ),
      ),
    ),
  )
}

describe('Charging a free visit', () => {
  it('settles it and completes the visit, and reopens it for a product sold there', () => {
    seedFreeVisit().then(({ account, appt }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.contains('[data-cy=appt-block]', 'Gratis Charla').click()
      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.get('[data-cy=appt-tab-billing]').click()
        cy.contains('button', 'Charge this visit').click()
        cy.get('[data-cy=appt-receipt-status]').should('contain.text', 'Paid')
      })

      cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
        expect(invoices).to.have.length(1)
        expect(invoices[0].status, 'nothing is owed on a free visit').to.eq('paid')
        expect(invoices[0].total_cents).to.eq(0)
      })
      cy.task<{ status: string }>('db:appointmentById', { appointmentId: appt.id }).its('status').should('eq', 'completed')

      cy.get('[data-cy=appt-sheet]').within(() => {
        cy.contains('select', 'Add a service or product').select(1)
        cy.get('[data-cy=appt-receipt-status]').should('contain.text', 'Unpaid')
        cy.contains('Balance due:').should('contain.text', '35,00')
      })
      cy.task<any[]>('db:invoicesForAppointment', { appointmentId: appt.id }).then((invoices) => {
        expect(invoices).to.have.length(1)
        expect(invoices[0].status, 'the product is owed').to.eq('unpaid')
        expect(invoices[0].total_cents).to.eq(3500)
      })
    })
  })
})
