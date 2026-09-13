import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// A bono visit was reported as a debt because the appointment type is priced
// above the bono's per-session rate.
//
// Marta Abril: a €480 Bono mantenimiento (12 sessions, €40 each) with 4 left,
// an "Ajuste Quiropractico" priced at €55, and €160 of her own money sitting
// with the clinic. Her appointment said "This visit costs more than the
// package covers — patient owes the difference". She owes nothing: taking the
// visit from the bono charges the BONO's rate, so €40 comes off what she has
// already paid. The €55 never enters it.
const bookedDay = yesterday()

describe('An appointment covered by a bono', () => {
  it('states the rate it will be charged at, and what the patient is holding', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste Quiropractico', durationMinutes: 15, defaultPriceCents: 5500 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Cubierta' }).then((patient: any) => {
        // Paid €480 for the bono, charged €40 for each of the 8 visits taken:
        // €160 of it is still hers.
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 48000, method: 'card' })
        for (let i = 0; i < 8; i++) {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4000, status: 'paid' })
        }
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono mantenimiento',
          sessionsTotal: 12,
          sessionsUsed: 8,
          priceCents: 48000,
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        openNewAppointmentPanel()

        cy.get('.fixed.inset-0.z-50').within(() => {
          cy.get('input[placeholder="Search by name, phone, or email…"]').type('Marta')
          cy.contains('li', 'Marta Cubierta').click()
          cy.get('select').eq(0).should('contain.text', 'Ajuste Quiropractico').select('Ajuste Quiropractico (15 min)')
          cy.contains('label', 'Practitioner').parent().find('select').select(SEEDED_PRACTITIONER)
          cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
          cy.contains('button', /^Create$/).click()
        })
        cy.get('.fixed.inset-0.z-50').should('not.exist')

        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)
        cy.contains('Marta Cubierta').should('be.visible').click({ force: true })
        cy.contains('h2', 'Edit Appointment').should('be.visible')

        cy.get('.fixed.inset-0.z-50').within(() => {
          // The €55 type against a €40 bono used to read as a debt.
          cy.contains('patient owes the difference').should('not.exist')
          cy.contains('Covered by package at €40.00 (3 sessions left after this one)').should('be.visible')
          // And what she is holding, which this screen never said at all.
          cy.contains('€160.00 credit').should('be.visible')
          // Her only booking is the one being edited, so she is about to fall
          // out of the schedule. That warning now lives here, on the tab about
          // the booking, instead of at the bottom of Billing.
          cy.contains('No future appointment — this patient will show up in Recalls automatically.').should('be.visible')

          // Billing offers the bono first, at its own rate, and demotes the
          // walk-in price -- the reverse of what it used to do.
          cy.contains('button', 'billing').click()
          cy.contains('Not charged yet').should('be.visible')
          cy.contains('button', 'Use Bono mantenimiento — €40.00').should('be.visible')
          cy.contains('button', 'Charge €55.00 instead').should('be.visible')
          cy.contains('Or use a package session').should('not.exist')
        })
      })
    })
  })
})
