import type { StaffAccount } from '../../support/commands'

// The sidebar (components/AppSidebar.vue): badges that match the page they
// link to and keep up with it, names that survive being collapsed to icons,
// a clinic switcher that survives it too, and groups that fold.

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

function lapsedPatient(account: StaffAccount, clinicId: string, first: string, days: number) {
  return cy
    .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId, firstName: first, lastName: 'Recall', phone: '612345678' })
    .then((p) => {
      cy.task('db:createAppointment', { accountId: account.accountId, clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysAgo(days), status: 'completed' })
      return cy.wrap(p.id)
    })
}

function openDashboard(account: StaffAccount) {
  cy.login(account.email, account.password)
  cy.visit('/dashboard')
  cy.get('[data-cy=sidebar]').should('have.attr', 'data-ready', 'true')
}
const sidebar = () => cy.get('[data-cy=sidebar]')
const item = (to: string) => cy.get(`[data-cy=nav-item][data-to="${to}"]`)

describe('Sidebar', () => {
  it('counts recalls the way the Recalls page lists them, and follows a snooze there', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' }).then((north) => {
        // Main clinic: two lapsed past 3 weeks, one only 10 days ago.
        lapsedPatient(account, account.clinicId, 'Ana', 40)
        lapsedPatient(account, account.clinicId, 'Bea', 30)
        lapsedPatient(account, account.clinicId, 'Carla', 10)
        // The other clinic: one more, which the main clinic's badge must not count.
        lapsedPatient(account, north.id, 'Dora', 50)

        openDashboard(account)
        item('/recalls').find('[data-cy=nav-badge-recalls]').should('have.text', '2')

        // The badge is the list's length.
        item('/recalls').click()
        cy.get('[data-cy=recalls-page]').should('have.attr', 'data-ready', 'true')
        cy.get('[data-cy=recall-row]').should('have.length', 2)

        // Snoozing on the page moves the badge without leaving it.
        cy.contains('[data-cy=recall-row]', 'Ana Recall').find('[data-cy=recall-more]').click()
        cy.get('[data-cy=recall-snooze]').click()
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=recall-row]').should('have.length', 1)
        item('/recalls').find('[data-cy=nav-badge-recalls]').should('have.text', '1')

        // Switching clinic recounts for that clinic.
        cy.get('[data-cy=clinic-switcher]').click()
        cy.get('[data-cy=clinic-menu]').contains('button', 'Sede Norte').click()
        item('/recalls').find('[data-cy=nav-badge-recalls]').should('have.text', '1')
        cy.get('[data-cy=recall-row]').should('have.length', 1).and('contain.text', 'Dora Recall')
      })
    })
  })

  it('keeps names, the current page and the clinic switcher when collapsed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:addClinic', { accountId: account.accountId, name: 'Sede Norte' })
      openDashboard(account)
      item('/dashboard').should('have.attr', 'aria-current', 'page')
      item('/calendar').should('not.have.attr', 'aria-current')

      cy.get('[data-cy=sidebar-collapse]').click()
      sidebar().should('have.attr', 'data-collapsed', 'true')
      // Icons only, but each still has a name to be read by.
      item('/calendar').should('have.attr', 'aria-label', 'Calendar').and('not.contain.text', 'Calendar')
      item('/growth').should('have.attr', 'aria-label', 'Overview')

      // The clinic can still be changed without expanding first.
      cy.get('[data-cy=clinic-switcher]').should('have.attr', 'aria-label', 'Clinic: Main Location').click()
      cy.get('[data-cy=clinic-menu]').contains('button', 'Sede Norte').click()
      cy.get('[data-cy=clinic-switcher]').should('have.attr', 'aria-label', 'Clinic: Sede Norte')

      // Both remembered on this device -- the clinic by the server too, which
      // used to fall back to the first clinic on every reload.
      cy.reload()
      sidebar().should('have.attr', 'data-ready', 'true')
      sidebar().should('have.attr', 'data-collapsed', 'true')
      cy.get('[data-cy=clinic-switcher]').should('have.attr', 'aria-label', 'Clinic: Sede Norte')
      cy.get('[data-cy=sidebar-collapse]').click()
      sidebar().should('have.attr', 'data-collapsed', 'false')
      item('/calendar').should('contain.text', 'Calendar')
    })
  })

  it('folds a group away, but never the one holding the current page', () => {
    cy.seedStaffAccount().then((account) => {
      openDashboard(account)
      // One Dashboard, one Overview -- and no second link into the inbox.
      cy.get('[data-cy=nav-item]').filter(':contains("Dashboard")').should('have.length', 1)
      cy.get('[data-cy=nav-item][data-to^="/inbox?"]').should('not.exist')

      cy.get('[data-cy=nav-group-toggle-money]').should('have.attr', 'aria-expanded', 'true').click()
      cy.get('[data-cy=nav-group-toggle-money]').should('have.attr', 'aria-expanded', 'false')
      item('/billing').should('not.exist')

      // The page you are on keeps its group open, folded or not.
      cy.get('[data-cy=nav-group-toggle-today]').click()
      item('/dashboard').should('exist')
      cy.get('[data-cy=nav-group-toggle-today]').should('have.attr', 'aria-expanded', 'true')

      cy.reload()
      sidebar().should('have.attr', 'data-ready', 'true')
      item('/billing').should('not.exist')
      cy.get('[data-cy=nav-group-toggle-money]').click()
      item('/billing').should('exist')
    })
  })

  it('keeps Settings off the bottom-left corner, where the browser shows link addresses', () => {
    cy.seedStaffAccount().then((account) => {
      openDashboard(account)
      cy.get('[data-cy=nav-settings]').then(($s) => {
        const gap = Cypress.config('viewportHeight') - $s[0].getBoundingClientRect().bottom
        // Chrome's link-address bubble is about 25px tall.
        expect(gap, 'space under Settings').to.be.greaterThan(32)
      })
      cy.get('[data-cy=sidebar-collapse]').then(($c) => {
        expect($c[0].tagName, 'the corner holds a button, not a link').to.equal('BUTTON')
      })
    })
  })
})
