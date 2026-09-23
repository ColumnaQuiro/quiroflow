import { assertDayGridShows, yesterday } from '../../support/calendar'

// A visit covered by a prepaid bono must not ask the patient for money again.
//
// chargeTheVisit() raises the session charge and marks it paid when the
// patient's balance already covers it -- which for a prepaid bono it does,
// because the money went in when the bono was bought. No payment row is ever
// created, by design, and settle_imported_invoices() left the entire migrated
// history looking the same way.
//
// balanceDueCents read only the payment rows, so it showed the full session
// price as outstanding and put the take-payment box in front of reception.
// Five patients paid twice on 15 Sep that way, EUR 206 between them, every one
// of them holding a bono with nothing owed on it.
const bookedDay = yesterday()

describe('A visit the bono already paid for', () => {
  it('shows nothing due and does not offer to take payment', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Prue', lastName: 'Prepaid' }).then((patient: any) => {
        // A bono paid in full and barely touched: 12 sessions at EUR 40, the
        // whole EUR 480 already on the account.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono mantenimiento',
          sessionsTotal: 12,
          sessionsUsed: 0,
          priceCents: 48000,
          owedCents: 0,
        })
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 48000, method: 'card' })

        const startsAt = new Date(bookedDay)
        startsAt.setHours(9, 0, 0, 0)
        cy.task('db:createAppointment', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          startsAt: startsAt.toISOString(),
          practitionerId: account.teamMemberId,
        })

        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[aria-label="Previous"]').click()
        assertDayGridShows(bookedDay)

        cy.contains('Prue Prepaid').click({ force: true })
        cy.get('[data-cy=appt-sheet]').should('be.visible')

        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-tab-billing]').click()
          // Draw the visit from the bono, which is what reception does.
          cy.contains('button', 'Use Bono mantenimiento').click()

          // The money went in when the bono was bought. Asking again is the bug.
          cy.contains('Balance due: 0,00 €').should('be.visible')
          cy.contains('button', 'Take payment').should('not.exist')
        })

        // And nothing was collected.
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'no factura, because no money changed hands').to.have.length(0)
        })
      })
    })
  })
})
