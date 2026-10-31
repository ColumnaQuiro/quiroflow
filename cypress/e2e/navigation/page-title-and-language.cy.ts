// What a screen reader and a keyboard meet before the page itself: the tab's
// title (utils/screenTitle.ts), the page's language (app.vue) and a link
// past the sidebar (layouts/default.vue). All three were missing: every
// staff tab read its address, Spanish was read with an English voice, and
// eighteen sidebar links came before the content on every page.

describe('Page title, language and skip link', () => {
  it('names the screen in the tab and follows it from page to page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/practitioner')
      cy.title().should('equal', 'My Day · QuiroFlow')
      cy.get('html').should('have.attr', 'lang', 'en')

      cy.visit('/patients')
      cy.title().should('equal', 'Patients · QuiroFlow')
    })
  })

  it('sets the language and the title to the Spanish interface', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setStaffLanguage', { teamMemberId: account.teamMemberId, language: 'es' })
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.get('html').should('have.attr', 'lang', 'es')
      cy.title().should('equal', 'Calendario · QuiroFlow')
    })
  })

  it('offers a skip link that takes the keyboard to the page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.title().should('equal', 'Patients · QuiroFlow')
      // Out of sight until it has focus.
      cy.get('[data-cy=skip-to-content]').should('have.class', 'sr-only').and('have.attr', 'href', '#main-content')
      cy.get('[data-cy=skip-to-content]').focus()
      cy.get('[data-cy=skip-to-content]').should('be.visible').and('contain.text', 'Skip to content')
      cy.get('[data-cy=skip-to-content]').click()
      cy.focused().should('have.attr', 'id', 'main-content')
    })
  })

  // A screen reader lists a page by its headings. Both pages went from their
  // title (h1) straight to h3, so the outline had a hole under the title.
  it('steps the headings down one level at a time on the dashboard and the calendar', () => {
    const noSkippedLevel = () =>
      cy.get('main').find('h1, h2, h3, h4').then(($h) => {
        const levels = [...$h].map((el) => Number(el.tagName[1]))
        levels.forEach((level, i) => expect(level - (i ? levels[i - 1]! : 0), `heading ${i + 1} (h${level})`).to.be.at.most(1))
      })
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('main h2').should('have.length.greaterThan', 0)
      noSkippedLevel()
      cy.visit('/calendar')
      cy.get('main h2').should('have.length.greaterThan', 0)
      noSkippedLevel()
    })
  })
})
