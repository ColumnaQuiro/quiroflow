// Books yesterday rather than the panel's default of 09:00 today --
// AppointmentBillingTab raises no invoice for a visit that hasn't happened
// yet, so a 09:00-today appointment leaves this spec with no billing UI on
// any CI run starting before 09:00 UTC. See the same note in
// appointment-booking-and-billing.cy.ts.
function yesterdayInputValue() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

describe('Splitting an appointment payment across methods', () => {
  it('takes part cash, part card in one submit and completes the visit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createServiceProduct', { accountId: account.accountId, name: 'Adjustment', priceCents: 5000 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Priya', lastName: 'Partpay' }).then(
        () => {
          cy.login(account.email, account.password)
          cy.visit('/calendar')
          cy.contains('select', 'Work week').select('day')
          cy.clickUntil('button:contains("New Appointment")', 'input[placeholder="Search by name, phone, or email…"]')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.get('input[placeholder="Search by name, phone, or email…"]').type('Priya')
            cy.contains('li', 'Priya Partpay').click()
            cy.get('select').eq(0).should('contain.text', 'Consultation').select('Consultation (30 min)')
            cy.get('input[type="date"]').clear().type(yesterdayInputValue())
            cy.contains('button', /^Create$/).click()
          })
          cy.get('.fixed.inset-0.z-50').should('not.exist')
          // Booked for yesterday, so step the calendar back a day to see it.
          cy.get('[aria-label="Previous"]').click()
          cy.contains('Priya Partpay').should('be.visible')
          cy.contains('Priya Partpay').click({ force: true })
          cy.contains('h2', 'Edit Appointment').should('be.visible')

          cy.get('.fixed.inset-0.z-50').within(() => {
            cy.contains('button', 'billing').click()
            cy.get('select').eq(0).should('contain.text', 'Adjustment').select('Adjustment (€50.00)')
            cy.contains('Balance due: €50.00').should('be.visible')

            cy.contains('button', 'Process').parents('form').as('paymentForm')
            cy.get('@paymentForm').find('input[type="number"]').eq(0).clear().type('30')
            cy.get('@paymentForm').contains('button', 'Split into another method').click()
            // select[0] is this row-method select (no invoice picker here,
            // unlike the patient Billing tab -- one invoice per appointment)
            // -- the newly-added second row's method is select[1].
            cy.get('@paymentForm').find('input[type="number"]').eq(1).type('20')
            cy.get('@paymentForm').find('select').eq(1).select('Card')
            cy.get('@paymentForm').contains('Total: €50.00').should('be.visible')
            cy.get('@paymentForm').contains('button', 'Process').click()

            cy.contains('paid', { matchCase: false }).should('be.visible')
            cy.contains('Balance due: €0.00').should('be.visible')
            cy.contains('li', 'cash').should('contain', '€30.00')
            cy.contains('li', 'card').should('contain', '€20.00')
          })
        },
      )
    })
  })
})
