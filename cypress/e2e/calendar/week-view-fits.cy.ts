// The week view gives each day a sub-column per room, each at least 128px.
// A working week with one room and Unassigned needed 1,338px, so on a 1440px
// laptop the grid scrolled sideways and Friday started off the screen. The
// sub-columns now share out the width there is, down to a floor, before the
// grid scrolls.

describe('The week view on a laptop screen', () => {
  it('fits Monday to Friday at 1440px without scrolling sideways', () => {
    cy.viewport(1440, 900)
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').should('have.value', 'workweek')
      cy.get('[data-cy=grid-scroller]').should(($el) => {
        const el = $el[0]!
        expect(el.scrollWidth, 'grid width').to.be.at.most(el.clientWidth + 1)
      })
    })
  })

  it('still scrolls rather than squeezing a narrow window past the floor', () => {
    cy.viewport(1024, 768)
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 2' })
      cy.task('db:createRoom', { accountId: account.accountId, clinicId: account.clinicId, name: 'Sala 3' })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.get('[data-cy=grid-scroller] [data-cal-col]', { timeout: 30000 }).first().should(($col) => expect($col[0]!.getBoundingClientRect().width).to.be.at.least(75))
      cy.get('[data-cy=grid-scroller]').should(($el) => expect($el[0]!.scrollWidth).to.be.greaterThan($el[0]!.clientWidth))
    })
  })
})
