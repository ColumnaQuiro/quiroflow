import { SEEDED_PRACTITIONER, assertDayGridShows, dateInputValue, openNewAppointmentPanel, yesterday } from '../../support/calendar'

// A bono visit was reported as a debt because the appointment type is priced
// above the bono's per-session rate.
//
// Nieves Monteagudo: a €480 Bono mantenimiento (12 sessions, €40 each) with
// 4 left, an "Ajuste Quiropractico" priced at €55, and €160 of her own money
// sitting with the clinic. Her appointment said "This visit costs more than the
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

        cy.get('[data-cy=create-sheet]').within(() => {
          cy.get('[data-cy=create-patient-search]').type('Marta')
          cy.contains('[data-cy=create-patient-result]', 'Marta Cubierta').click()
          cy.contains('[data-cy=create-type]', 'Ajuste Quiropractico').click()
          cy.contains('[data-cy=create-practitioner]', SEEDED_PRACTITIONER).click()
          cy.get('input[type="date"]').clear().type(dateInputValue(bookedDay))
          cy.get('[data-cy=create-submit]').click()
        })
        cy.get('[data-cy=create-sheet]').should('not.exist')

        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)
        cy.contains('Marta Cubierta').should('be.visible').click({ force: true })
        cy.get('[data-cy=appt-sheet]').should('be.visible')

        cy.get('[data-cy=appt-sheet]').within(() => {
          // The €55 type against a €40 bono used to read as a debt. The
          // visit is charged at the bono's rate, and the panel says so.
          cy.contains('patient owes the difference').should('not.exist')
          cy.contains('[data-cy=visit-money]', 'Bono mantenimiento').should('contain.text', '4 of 12 left')
          cy.contains('[data-cy=visit-money]', 'uses 1 session at 40,00 €').should('be.visible')
          // And what she is holding, which this screen never said at all.
          cy.contains('[data-cy=patient-balance]', '160,00 € available').should('be.visible')
          // Her only booking is the one open, so she is about to fall out of
          // the schedule: the header says so, beside her visit count.
          cy.contains('[data-cy=appt-sheet-facts]', 'no next visit').should('be.visible')

          // Billing offers the bono first, at its own rate, and demotes the
          // walk-in price -- the reverse of what it used to do.
          cy.get('[data-cy=appt-tab-billing]').click()
          cy.contains('Not charged yet').should('be.visible')
          cy.contains('button', 'Use Bono mantenimiento — 40,00 €').should('be.visible')
          cy.contains('button', 'Charge 55,00 € instead').should('be.visible')
          cy.contains('Or use a package session').should('not.exist')
        })
      })
    })
  })
})
