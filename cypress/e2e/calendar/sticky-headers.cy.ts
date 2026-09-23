// Scrolling the grid keeps its bearings: the room (and, in the weeks, day)
// headers stay at the top, and the hours stay on the left, however far the
// grid is scrolled down or across. They used to scroll away with it -- the
// headers were sticky against a box that never scrolled.

describe('Calendar headers', () => {
  beforeEach(() => cy.viewport(1024, 768))

  it('stay in view while the grid scrolls, in the day and the week', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').select('day')

      cy.get('[data-cy=grid-scroller]').scrollTo(200, 500, { ensureScrollable: false })
      cy.get('[data-cy=grid-scroller]').then(($sc) => {
        const top = $sc[0].getBoundingClientRect().top
        cy.contains('[data-cy=grid-scroller] span', 'Room 1').should(($h) => expect(Math.abs($h[0].getBoundingClientRect().top - top)).to.be.lessThan(20))
      })

      cy.contains('select', 'Day').select('workweek')
      cy.get('[data-cy=grid-scroller]').scrollTo(1500, 400, { ensureScrollable: false })
      cy.get('[data-cy=grid-scroller]').then(($sc) => {
        const box = $sc[0].getBoundingClientRect()
        cy.get('[data-cy=day-header-counts]').first().should(($h) => expect($h[0].getBoundingClientRect().top - box.top).to.be.lessThan(40))
        // The hour labels, pinned to the left edge.
        cy.contains('[data-cy=grid-scroller] span', /^12:00$/).should(($l) => expect($l[0].getBoundingClientRect().left - box.left).to.be.lessThan(10))
      })
    })
  })
})
