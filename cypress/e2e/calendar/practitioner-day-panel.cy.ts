import { seedVisit, todayAt } from '../../support/calendar'

// The practitioner's day (/practitioner) opens a visit's details in the same
// panel the calendar uses, loaded for that one visit (useAppointmentPanelLoader)
// -- not the old edit modal with its Status dropdown. The calendar-only
// "Mover…" is hidden there; the time is still editable inline.

describe("The practitioner's day opens the calendar's appointment panel", () => {
  it('shows the visit with its money, advances it, and offers no calendar-only move', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then((room) => {
        seedVisit(account, room.id, 'Laura', 'Gómez', 10, 30, { confirmationStatus: 'confirmed', confirmationSentAt: todayAt(8, 0) }).then(({ patientId, appointmentId }) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId, totalCents: 4500, status: 'unpaid' })

          cy.login(account.email, account.password)
          cy.visit('/practitioner')
          // The details button shows on hover or keyboard focus with a mouse,
          // and always on touch; Cypress's pointer is neither, hence force.
          cy.contains('li', 'Laura Gómez').find('[data-cy=practitioner-open-appointment]').click({ force: true })

          cy.get('[data-cy=appt-sheet]').within(() => {
            cy.contains('Laura Gómez').should('exist')
            // Loaded for this one visit: the patient's unpaid balance is there.
            cy.get('[data-cy=collect-balance]').should('contain.text', '45,00')
            // Moving is the calendar's reschedule mode; here the time is edited inline.
            cy.get('[data-cy=move-appointment]').should('not.exist')
            cy.get('[data-cy=appt-edit]').should('exist')
            // No Status dropdown: one next step instead.
            cy.get('select').should('not.exist')
            cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'checkin').click()
            cy.get('[data-cy=advance-stage]').should('have.attr', 'data-next', 'withp')
          })
          cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId }).its('checked_in_at').should('not.be.null')

          cy.get('body').type('{esc}')
          cy.get('[data-cy=appt-sheet]').should('not.exist')
        })
      })
    })
  })
})
