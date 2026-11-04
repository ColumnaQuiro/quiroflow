// At 200% zoom (720x450) the rows above the Inbox list -- trial banner, top
// bar, title, notifications banner, search, tabs, chips -- took ~330 of 450px
// and left one and a half conversations. The banners can be put away and
// stay away; on a short window the tabs and chips fold behind one button
// that names what is narrowing the list.

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()

describe('Inbox header on a short window', () => {
  it('folds the tabs and chips behind a button that names the filter', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Corta' }).then((p) =>
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, phoneNumber: '+34600000011', direction: 'inbound', bodyPreview: 'Hola', createdAt: minutesAgo(5) }),
      )
      cy.viewport(720, 450)
      cy.login(account.email, account.password)
      cy.visit('/inbox')
      cy.get('[data-cy=inbox-row]').should('have.length', 1)

      cy.get('[data-cy=inbox-tabs]').should('not.be.visible')
      cy.get('[data-cy=inbox-filter-needs-reply]').should('not.be.visible')
      // The default is a filter too, and says so.
      cy.get('[data-cy=inbox-filters-toggle]').should('be.visible').and('contain.text', 'Needs reply').and('have.attr', 'aria-expanded', 'false')

      cy.clickUntil('[data-cy=inbox-filters-toggle]', '[data-cy=inbox-tabs]:visible')
      cy.get('[data-cy=inbox-filters-toggle]').should('have.attr', 'aria-expanded', 'true')
      cy.get('[data-cy=inbox-filter-needs-reply]').click()
      cy.get('[data-cy=inbox-filters-toggle]').should('contain.text', 'Filters').and('not.contain.text', 'Needs reply')
      cy.get('[data-cy=inbox-filter-unread]').click()
      cy.get('[data-cy=inbox-tab-mine]').click()
      cy.get('[data-cy=inbox-filters-toggle]').should('contain.text', 'Filters · 2')
        .and('have.attr', 'aria-label', 'Filters: Mine, Unread')

      cy.get('[data-cy=inbox-filters-toggle]').click()
      cy.get('[data-cy=inbox-tabs]').should('not.be.visible')

      // Beside a thread the list is a 340px column with no room for the
      // button: there the rows stay, and the search keeps its width.
      cy.viewport(960, 600)
      cy.get('[data-cy=inbox-tabs]').should('be.visible')
      cy.get('[data-cy=inbox-filters-toggle]').should('not.be.visible')
      cy.get('[data-cy=inbox-search]').invoke('outerWidth').should('be.gt', 100)

      // A window of ordinary height shows the rows and no button.
      cy.viewport(1280, 900)
      cy.get('[data-cy=inbox-tabs]').should('be.visible')
      cy.get('[data-cy=inbox-filters-toggle]').should('not.be.visible')
    })
  })

  it('remembers "Not now" on the notifications banner', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // Electron answers for itself otherwise; the banner is for a browser
      // that has not been asked yet.
      const notAskedYet = { onBeforeLoad: (win: Window & typeof globalThis) => Object.defineProperty(win.Notification, 'permission', { get: () => 'default' }) }
      cy.visit('/inbox', notAskedYet)
      cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=push-banner]').should('be.visible')
      // Drawn only once the page is running, so a plain click is a hydrated one.
      cy.get('[data-cy=push-not-now]').click()
      cy.get('[data-cy=push-banner]').should('not.exist')

      cy.visit('/inbox', notAskedYet)
      cy.get('[data-cy=inbox-list]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=push-banner]').should('not.exist')
    })
  })

  it('hides the trial banner for a day, but not in the last three days', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'subscriptions', match: { account_id: account.accountId }, values: { status: 'trialing', trial_ends_at: daysFromNow(10) } })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=trial-banner]').should('contain.text', '10 days left in your trial')
      cy.get('[data-cy=trial-banner-hide]').click()
      cy.get('[data-cy=trial-banner]').should('not.exist')
      cy.reload()
      cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')
      cy.get('[data-cy=trial-banner]').should('not.exist')

      // Near the end it comes back, with nothing to put it away.
      cy.task('db:updateRows', { table: 'subscriptions', match: { account_id: account.accountId }, values: { trial_ends_at: daysFromNow(2) } })
      cy.reload()
      cy.get('[data-cy=trial-banner]').should('contain.text', '2 days left in your trial')
      cy.get('[data-cy=trial-banner-hide]').should('not.exist')
    })
  })
})
