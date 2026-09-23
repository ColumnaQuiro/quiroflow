// A red line marks now across today, in the day and the week views, with the
// time in the gutter. CI runs at any hour, so what is asserted depends on
// whether now falls inside the grid's 08:00-20:00 at all.

function withinGrid(d = new Date()) {
  return d.getHours() >= 8 && d.getHours() < 20
}

describe('The now line', () => {
  it('crosses today in the day view and in the week, and nowhere else', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      if (!withinGrid()) {
        cy.get('[data-cy=now-line]').should('not.exist')
        return
      }
      cy.get('[data-cy=now-line]').should('have.length', 1)
      cy.get('[data-cy=now-label]').invoke('text').should('match', /^\d\d:\d\d$/)
      // Its colour is the danger token: the one red on the calendar that is
      // not money.
      cy.get('[data-cy=now-line]').children().last().should('have.class', 'bg-danger-text')

      // Another day has no line.
      cy.get('[aria-label="Next"]').click()
      cy.get('[data-cy=now-line]').should('not.exist')
      cy.get('[aria-label="Previous"]').click()

      // The week: one line, on today's column only.
      cy.contains('select', 'Day').select('week')
      cy.get('[data-cy=now-line]').should('have.length', 1)
      cy.get('[data-cy=now-label]').should('have.length', 1)
    })
  })
})
