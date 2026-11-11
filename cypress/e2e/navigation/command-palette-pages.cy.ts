// "Go to" in the top-bar search (AppCommandPalette). It was a list written by
// hand: it offered Billing and Settings to roles that cannot open them, and
// pages added to the sidebar since (Waitlist, Team chat, Staff...) and every
// Settings page were missing. It is built from the sidebar's own list and the
// Settings menu's now (composables/useSidebarNavItems, useSettingsNavItems),
// so it offers what those show this person and nothing else.

const PASSWORD = 'Test1234!'
const page = (to: string) => cy.get(`[data-cy=palette-page][data-to="${to}"]`)
const search = (text: string) => cy.get('[role=dialog] input').clear().type(text)

function openPalette() {
  cy.visit('/dashboard')
  // Rendered on the server: a click before hydration does nothing.
  cy.clickUntil('button[title^="Search or jump to"]', '[role=dialog] input')
}

describe('Pages in the top-bar search', () => {
  it('offers an owner every page, Settings pages included, and opens one with Enter', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      openPalette()

      // Nothing typed: the sidebar's pages, and Settings as one entry.
      for (const to of ['/calendar', '/waitlist', '/care-plan-alerts', '/exercises', '/team-chat', '/jornada', '/personal', '/billing', '/settings']) page(to).should('exist')
      page('/growth/leads').should('contain.text', 'Growth › Leads')
      page('/settings/whatsapp').should('not.exist')

      search('whatsapp')
      page('/settings/whatsapp').should('contain.text', 'Settings › WhatsApp')
      search('verifactu')
      page('/settings/verifactu').should('exist')
      // Campaigns became Automations; the old name still finds it.
      search('campaigns')
      page('/automations').should('exist')

      // Every word, in any order.
      search('team settings')
      page('/settings/team').should('have.attr', 'aria-selected', 'true')
      cy.get('[role=dialog] input').type('{enter}')
      cy.location('pathname').should('eq', '/settings/team')
    })
  })

  it('offers a restricted role only the pages it can open', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `palette-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { dashboard_scope: 'all', calendar_scope: 'all', recalls_access: true, billing_access: false, reports_access: false, settings_access: true, communication_config: true, billing_config: false, clinic_config: false },
      })
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Palette Test' })

      cy.login(email, PASSWORD)
      openPalette()

      page('/calendar').should('exist')
      page('/waitlist').should('exist')
      for (const to of ['/billing', '/reports', '/personal']) page(to).should('not.exist')

      // In Settings, what the Settings menu shows this role: its own
      // permission per page, and owners-only pages to owners.
      search('whatsapp')
      page('/settings/whatsapp').should('exist')
      search('settings')
      page('/settings/messages').should('exist')
      for (const to of ['/settings/payments', '/settings/clinics', '/settings/verifactu', '/settings/activity']) page(to).should('not.exist')

      search('billing')
      cy.get('[role=dialog]').should('contain.text', 'No matches.')
      cy.get('[data-cy=palette-page]').should('not.exist')
    })
  })

  it('offers no Settings page to a role without Settings', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `palette-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
      // The page's own permission is not enough without settings_access.
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { dashboard_scope: 'all', calendar_scope: 'all', settings_access: false, communication_config: true } })
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Palette Test' })

      cy.login(email, PASSWORD)
      openPalette()
      page('/calendar').should('exist')
      page('/settings').should('not.exist')
      search('settings')
      cy.get('[role=dialog]').should('contain.text', 'No matches.')
      cy.get('[data-cy=palette-page]').should('not.exist')
    })
  })
})
