// The sidebar's list scrolls when the window is shorter than it. It used to
// do so with nothing to say there was more: at 900px tall the last three
// items were simply missing. While anything sits below, the bottom edge fades
// with a chevron; scrolled to the end, or on a tall enough window, it goes.

describe('Sidebar: more below', () => {
  it('says there is more below on a short window, and stops at the end', () => {
    cy.seedStaffAccount().then((account) => {
      cy.viewport(1280, 640)
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=sidebar-more-below]').should('exist')

      // Scrolled to the end, nothing is left below.
      cy.get('[data-cy=sidebar] nav').scrollTo('bottom')
      cy.get('[data-cy=sidebar-more-below]').should('not.exist')

      cy.viewport(1280, 1600)
      cy.get('[data-cy=sidebar] nav').scrollTo('top', { ensureScrollable: false })
      cy.get('[data-cy=sidebar-more-below]').should('not.exist')
    })
  })
})
