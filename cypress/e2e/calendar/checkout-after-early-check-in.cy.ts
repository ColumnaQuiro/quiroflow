import { seedVisit } from '../../support/calendar'

// A patient checked in before their slot starts -- in at 10:16 for 10:30 --
// has a visit that can be charged (isVisitUpcoming). The panel's checkout
// read that once, as it opened, so checking them in from the panel left the
// checkout off the screen until the panel was closed and opened again.
//
// Tomorrow, so the slot is in the future at any hour the suite runs.
function tomorrowAt(h: number): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

describe('Checking a patient in before their slot', () => {
  it('offers the checkout at once, without reopening the panel', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, defaultPriceCents: 5500 }).then((type) => {
        seedVisit(account, null, 'Pronto', 'Llegado', 10, 0, { appointmentTypeId: type.id, startsAt: tomorrowAt(10) })
        cy.login(account.email, account.password)
        cy.visit('/calendar')
        cy.contains('select', 'Work week').select('day')
        cy.get('[aria-label="Next"]').click()
        cy.contains('[data-cy=appt-block]', 'Pronto Llegado').click()

        cy.get('[data-cy=appt-sheet]').within(() => {
          // Not here yet, and the slot is tomorrow: nothing to charge.
          cy.get('[data-cy=visit-checkout]').should('not.exist')
          cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkin').click()
          // Scrolled to first: the block appears at the top of a panel the
          // click scrolled down to the stage button, under the panel's header,
          // and Cypress calls what is covered not visible
          // (visit-checkout-first-screen.cy.ts does the same).
          cy.get('[data-cy=visit-checkout]', { timeout: 15000 }).scrollIntoView().should('be.visible')
          cy.contains('[data-cy=checkout-process]', '55,00 €').should('exist')
        })
      })
    })
  })
})
