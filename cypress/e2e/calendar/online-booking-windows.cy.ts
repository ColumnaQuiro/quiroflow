import type { StaffAccount } from '../../support/commands'

// The hours kept for booking a type online, tinted on the calendar in that
// type's colour (utils/calendarBookingWindows.ts). A clinic that offers first
// visits online only at set times (appointment_types.online_booking_windows)
// could not see those times on its own diary, and filled them by hand.
//
// Only a type that is bookable online AND limited to set times is tinted; the
// unit tests cover the clipping to working hours and the practitioner rules.

const EVERY_DAY_9_TO_7 = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['09:00', '19:00']]]))
/** Today's weekday as the grid reads it: the browser's local day, like dayKeyFor. */
const TODAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]
const TEN_TO_ELEVEN = { all: { [TODAY]: [['10:00', '11:00']] } }

function seed(): Cypress.Chainable<{ account: StaffAccount; firstVisitId: string }> {
  return cy.seedStaffAccount().then((account) =>
    cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 1' }).then(() => {
      cy.task('db:setTeamMemberHours', { teamMemberId: account.teamMemberId, hours: EVERY_DAY_9_TO_7 })
      // Kept for online first visits from 10:00 to 11:00 today.
      return cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', onlineBookingEnabled: true }).then((firstVisit) => {
        cy.task('db:updateRows', { table: 'appointment_types', values: { color: '#8b5cf6', online_booking_windows: TEN_TO_ELEVEN }, match: { id: firstVisit.id } })
        // Same window, but not offered online at all: nothing to tint.
        cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Informe', onlineBookingEnabled: false }).then((report) => {
          cy.task('db:updateRows', { table: 'appointment_types', values: { online_booking_windows: TEN_TO_ELEVEN }, match: { id: report.id } })
        })
        return cy.wrap({ account, firstVisitId: firstVisit.id })
      })
    }),
  )
}

describe('Calendar: hours kept for online booking', () => {
  it("tints a type's online window in its colour, and only while it is offered online", () => {
    seed().then(({ account, firstVisitId }) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.get('[data-cy=online-booking-window]')
        .should('have.length.at.least', 1)
        .first()
        .should('contain.text', 'Primera visita · online')
        .and('not.contain.text', 'Informe')
        .should(($band) => {
          // The type's colour on the band's edge: #8b5cf6 is rgb(139, 92, 246).
          expect(getComputedStyle($band[0]).boxShadow).to.contain('rgb(139, 92, 246)')
          expect($band[0].getBoundingClientRect().height, 'an hour tall, not a sliver').to.be.greaterThan(20)
        })
      cy.contains('[data-cy=online-booking-window]', 'Informe').should('not.exist')

      // Switched off for online booking: the hours are no longer kept.
      cy.task('db:updateRows', { table: 'appointment_types', values: { online_booking_enabled: false }, match: { id: firstVisitId } })
      cy.reload()
      cy.get('[data-cy=closed-hours]').should('exist')
      cy.get('[data-cy=online-booking-window]').should('not.exist')
    })
  })
})
