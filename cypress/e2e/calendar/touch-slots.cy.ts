import { seedVisit } from '../../support/calendar'

// On an iPad a finger resting on the grid while scrolling must not open a
// booking form. The first tap on a free slot shows "+ Book HH:MM"; a second
// tap on the same slot books it. A tap on a visit opens it straight away,
// with no hover card in between. 1024x768, an iPad on its side.

function tap(el: Cypress.Chainable<JQuery<HTMLElement>>, x: number, y: number) {
  // pointerdown says it is a finger; the click that follows is what the
  // browser synthesises for a tap. cy.click() would report a mouse.
  el.trigger('pointerdown', x, y, { pointerType: 'touch', pointerId: 3 }).trigger('click', x, y)
}

describe('Booking by touch', () => {
  beforeEach(() => cy.viewport(1024, 768))

  it('shows the slot on the first tap and books it on the second', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Tocada', 'Cita', 12, 0, { confirmationStatus: 'confirmed' })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')
      cy.contains('[data-cy=appt-block]', 'Tocada Cita').should('exist')

      cy.get('[data-cal-col]').first().then(($col) => {
        const hourPx = $col[0].getBoundingClientRect().height / 12
        const y = hourPx * 2.5 + 5 // 10:30, Room 1, nothing booked

        tap(cy.wrap($col), 40, y)
        cy.get('[data-cy=slot-ghost]').should('contain.text', 'Book 10:30')
        cy.get('[data-cy=create-sheet]').should('not.exist')

        // A tap somewhere else moves the ghost; still nothing opens.
        tap(cy.wrap($col), 40, y + hourPx)
        cy.get('[data-cy=slot-ghost]').should('contain.text', 'Book 11:30')
        cy.get('[data-cy=create-sheet]').should('not.exist')

        // The second tap on the same slot books it.
        tap(cy.wrap($col), 40, y + hourPx)
        cy.get('[data-cy=create-sheet]').should('be.visible')
        cy.get('[data-cy=create-when]').should('contain.text', '11:30')
      })
    })
  })

  it('opens a visit on one tap, with no hover card', () => {
    cy.seedStaffAccount().then((account) => {
      seedVisit(account, null, 'Tocada', 'Cita', 12, 0, { confirmationStatus: 'confirmed' })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.contains('[data-cy=appt-block]', 'Tocada Cita').trigger('pointerenter', { pointerType: 'touch' }).trigger('pointerdown', { pointerType: 'touch', pointerId: 4 }).trigger('click')
      cy.get('[data-cy=appt-sheet]').should('be.visible')
      cy.get('[data-cy=appt-hover]').should('not.exist')
    })
  })
})
