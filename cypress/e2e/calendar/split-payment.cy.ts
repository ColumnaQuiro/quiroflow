import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// Books yesterday rather than the panel's default of 09:00 today --
// AppointmentBillingTab raises no invoice for a visit that hasn't happened
// yet, so a 09:00-today appointment leaves this spec with no billing UI on
// any CI run starting before 09:00 UTC. See the same note in
// appointment-booking-and-billing.cy.ts.
//
// Yesterday, not a fixed weekday -- see yesterday() for why the weekday
// makes no difference to this grid.
const bookedDay = yesterday()

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
          openNewAppointmentPanel()

          cy.get('[data-cy=create-sheet]').within(() => {
            cy.get('[data-cy=create-patient-search]').type('Priya')
            cy.contains('[data-cy=create-patient-result]', 'Priya Partpay').click()
            cy.contains('[data-cy=create-type]', 'Consultation').click()
            // Named explicitly rather than left to the panel's prefill. An
            // appointment with no practitioner is filtered out of every
            // practitioner tab by loadAppointments() and so never reaches
            // the grid -- see openNewAppointmentPanel().
            cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
            cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
            cy.get('[data-cy=create-submit]').click()
          })
          cy.get('[data-cy=create-sheet]').should('not.exist')
          // Booked for yesterday, so step the calendar back a day to see
          // it -- and check the grid actually got there before reading it.
          cy.get('[aria-label="Previous"]').click()
          assertDayGridShows(bookedDay)
          cy.contains('Priya Partpay').should('be.visible')
          cy.contains('Priya Partpay').click({ force: true })
          cy.get('[data-cy=appt-sheet]').should('be.visible')

          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.get('[data-cy=appt-tab-billing]').click()
            // The visit isn't invoiced until someone says so -- see
            // ensureInvoice(); this is that decision.
            cy.contains('button', 'Charge this visit').click()
            cy.get('select').eq(0).should('contain.text', 'Adjustment').select('Adjustment (50,00 €)')
            cy.contains('Balance due: 50,00 €').should('be.visible')

            cy.contains('button', 'Process').parents('form').as('paymentForm')
            cy.get('@paymentForm').find('input[type="number"]').eq(0).clear().type('30')
            cy.get('@paymentForm').contains('button', 'Split into another method').click()
            // select[0] is this row-method select (no invoice picker here,
            // unlike the patient Billing tab -- one invoice per appointment)
            // -- the newly-added second row's method is select[1].
            cy.get('@paymentForm').find('input[type="number"]').eq(1).type('20')
            cy.get('@paymentForm').find('select').eq(1).select('Card')
            cy.get('@paymentForm').contains('Total: 50,00 €').should('be.visible')
            cy.get('@paymentForm').contains('button', 'Process').click()

            cy.contains('paid', { matchCase: false }).should('be.visible')
            cy.contains('Balance due: 0,00 €').should('be.visible')
            cy.contains('li', 'cash').should('contain', '30,00 €')
            cy.contains('li', 'card').should('contain', '20,00 €')
          })
        },
      )
    })
  })
})
