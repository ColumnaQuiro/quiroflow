import { assertDayGridShows, yesterday } from '../../support/calendar'

// Money still owed on a bono shows in the appointment panel, beside the bono.
//
// A patient who paid half of a bono up front owes the other half, and the
// place reception is when they ask for it is the visit. Until this the debt
// was only on the patient's own Billing tab: the panel said "Bono: 6 left"
// and nothing else, so it went unasked for at the desk.
const bookedDay = yesterday()

describe('The appointment panel and a bono with money owed on it', () => {
  it('shows what is owed beside the bono, and nothing beside a paid one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Hal', lastName: 'Halfpaid' }).then((patient: any) => {
        // Sold here at EUR 480, EUR 240 paid towards it: EUR 240 owed.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono mantenimiento',
          sessionsTotal: 12,
          sessionsUsed: 1,
          priceCents: 48000,
          owedCents: 48000,
        }).then((bono: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, packagePurchaseId: bono.id, amountCents: 24000, method: 'card', purpose: 'bono' })
        })
        // And one paid in full, which owes nothing and must say nothing.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 10',
          sessionsTotal: 10,
          sessionsUsed: 2,
          priceCents: 40000,
          owedCents: 0,
        })

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

        cy.contains('Hal Halfpaid').click({ force: true })
        cy.get('[data-cy=appt-sheet]').should('be.visible')

        cy.get('[data-cy=appt-sheet]').within(() => {
          cy.get('[data-cy=appt-tab-billing]').click()
          cy.contains('Bono mantenimiento: 11 left').should('be.visible')
          cy.contains('Bono 10: 8 left').should('be.visible')
          // One pill, for the half-paid bono only.
          // formatEur puts a no-break space before the €, which contain.text
          // compares literally; read the text with its whitespace folded.
          cy.get('[data-cy=appointment-bono-owed]')
            .should('have.length', 1)
            .invoke('text')
            .should((text) => expect(text.replace(/\s+/g, ' ').trim()).to.eq('240,00 € owed'))
        })
      })
    })
  })
})
