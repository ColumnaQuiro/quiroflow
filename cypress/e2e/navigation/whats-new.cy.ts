// Novedades (pages/novedades.vue, components/news/TopBarButton.vue): the top
// bar's button where the help assistant used to be, its panel, and the page,
// all from utils/productNews.ts. What is unread on a given day depends on the
// entries' dates, so this checks that seeing them clears the count and that
// it stays cleared after a reload, not how many there are.
describe('What’s new', () => {
  it('opens from the top bar, explains where a change is, and remembers it was read', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')

      cy.get('[data-cy=support-open]').should('not.exist')
      cy.get('[data-cy=news-open]').click()
      cy.get('[data-cy=news-panel]').should('be.visible')
      cy.get('[data-cy=news-see-all]').click()
      cy.location('pathname').should('eq', '/novedades')

      // A change says where it lives and, opened, how to use it.
      cy.get('[data-cy=news-entry-day-hours]').should('contain.text', 'Settings › Team')
      cy.get('[data-cy=news-howto-day-hours]').should('not.exist')
      cy.get('[data-cy=news-toggle-day-hours]').click()
      cy.get('[data-cy=news-howto-day-hours]').should('contain.text', 'Add a day')
      cy.get('[data-cy=news-go-day-hours]').should('have.attr', 'href', '/settings/team')

      // Fixes are folded under one line a week.
      cy.get('[data-cy=news-entry-fix-same-time-not-a-clash]').should('not.exist')
      cy.get('[data-cy=news-fixes-toggle]').first().click()
      cy.get('[data-cy=news-entry-fix-same-time-not-a-clash]').should('be.visible')

      // The type filter narrows the list.
      cy.get('[data-cy=news-filter-fix]').click()
      cy.get('[data-cy=news-entry-day-hours]').should('not.exist')
      cy.get('[data-cy=news-entry-fix-same-time-not-a-clash]').should('be.visible')

      // Having been here, nothing is unread -- on this visit and the next.
      cy.get('[data-cy=news-unread-count]').should('not.exist')
      cy.reload()
      cy.get('[data-cy=news-page]').should('be.visible')
      cy.get('[data-cy=news-unread-count]').should('not.exist')
    })
  })
})
