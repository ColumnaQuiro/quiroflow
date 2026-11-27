import { seedVisit } from '../../support/calendar'

// With the pointer anywhere on the grid, the hour gutter marks the time it is
// at, so a row can be read off without following a gridline across the
// screen. It follows the pointer over a visit's card as well as over a free
// slot, and goes when the pointer leaves the grid.

const label = () => cy.get('[data-cy=hover-time-label]')
const rectOf = ($el: JQuery<HTMLElement>) => $el[0].getBoundingClientRect()

describe('Calendar: the time under the pointer', () => {
  it('is marked in the gutter over free slots and over visits', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Hora', 'Marcada', 11, 0)
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.get('[data-cy=day-column-head]').should('exist')
      cy.contains('[data-cy=appt-block]', 'Hora Marcada').should('exist')

      label().should('not.exist')

      cy.contains('[data-cy=appt-block]', 'Hora Marcada')
        .closest('[data-cal-col]')
        .then(($col) => {
          const col = rectOf($col)
          // The day grid is twelve hours (08:00-20:00) tall.
          const y = (col.height / 12) * 2 + 4 // just past 10:00
          cy.wrap($col).trigger('pointermove', 8, y, { pointerType: 'mouse' })
          label().should('be.visible').and('have.text', '10:00')

          cy.wrap($col).trigger('pointerleave')
          label().should('not.exist')
        })

      // Over the card: the event bubbles up to its column.
      cy.contains('[data-cy=appt-block]', 'Hora Marcada').then(($b) => {
        const r = rectOf($b)
        cy.wrap($b).trigger('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + 2, pointerType: 'mouse' })
      })
      label().should('be.visible').and('have.text', '11:00')
    })
  })
})
