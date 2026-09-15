import { assertDayGridShows, yesterday } from '../../support/calendar'

// The visit-checkout screen gates "Credit on account" on the same figure the
// Billing tab does -- spendableCreditCents, which lives in
// usePatientFinancialSummary precisely so one patient cannot get two different
// answers depending on which screen reception happens to be on.
//
// It used to gate on creditLedgerCents here, counting only account_credits
// rows. Three patients in the database have one, so the option was invisible
// at checkout even for a patient sitting on a real overpayment.
//
// Yesterday, because AppointmentBillingTab raises no invoice for a visit that
// has not happened yet -- see appointment-booking-and-billing.cy.ts.
const bookedDay = yesterday()

describe('Paying for a visit from credit at checkout', () => {
  it('offers a genuine overpayment, with no account_credits row in sight', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ovid', lastName: 'Overpaid' }).then((patient: any) => {
        // Money on account settling no particular charge, and no bono to be
        // committed to. Deliberately NOT an account_credits row -- that is the
        // shape the old gate could see, and the point is that this one works.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 8000, method: 'cash' })

        const startsAt = new Date(bookedDay)
        startsAt.setHours(9, 0, 0, 0)
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: startsAt.toISOString(),
          // Named explicitly: loadAppointments() filters an appointment with
          // no practitioner out of every practitioner tab, so it never
          // reaches the grid to be clicked.
          practitionerId: account.teamMemberId,
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)

        cy.contains('Ovid Overpaid').click({ force: true })
        cy.contains('h2', 'Edit Appointment').should('be.visible')

        cy.get('.fixed.inset-0.z-50').within(() => {
          cy.contains('button', 'billing').click()
          cy.contains('button', 'Charge this visit').click()
          cy.get('select').eq(0).should('contain.text', 'Adjustment').select('Adjustment (€50.00)')
          cy.contains('Balance due: €50.00').should('be.visible')

          // €80 paid in, nothing invoiced until just now, no bono: all of it
          // spendable. The old gate showed no credit option here at all.
          cy.contains('label', 'Method').parent().find('select').as('method')
          cy.get('@method').find('option[value="credit"]').should('not.be.disabled')
        })
      })
    })
  })
})
