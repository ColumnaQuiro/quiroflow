// "Ver leads" (leads_access): Growth's Leads board and the lead routes behind
// it, for a role that must not have "Comunicación y Growth" -- which is
// Settings: WhatsApp setup, templates, automations. Reception could not work
// the leads an ad brought in without being able to rewrite all of that.

const PASSWORD = 'Test1234!'

describe('Leads permission', () => {
  it('opens the Leads board and its routes to reception without the rest of Growth', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { communication_config: false, leads_access: false } })
      const email = `leads-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: PASSWORD, fullName: 'Recepción' })
      cy.task<{ id: string }>('db:createLead', { accountId: account.accountId, fullName: 'Leire Permiso Lead', stage: 'new', source: 'Meta Ads · Permiso', phone: '+34600444901' }).then((lead) => {
        cy.login(email, PASSWORD)

        // Without it: no link, and the routes refuse.
        cy.visit('/calendar')
        cy.get('a[href="/growth/leads"]').should('not.exist')
        cy.request({ url: '/api/growth/leads', failOnStatusCode: false }).its('status').should('eq', 403)
        cy.request({ url: `/api/growth/leads/${lead.id}`, failOnStatusCode: false }).its('status').should('eq', 403)

        // With it: the board, the lead and its conversations -- and still not
        // Growth's settings-level pages.
        cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { leads_access: true } })
        cy.request({ url: '/api/growth/leads', failOnStatusCode: false }).its('status').should('eq', 200)
        cy.request({ url: `/api/growth/leads/${lead.id}`, failOnStatusCode: false }).its('status').should('eq', 200)
        cy.request({ url: '/api/growth/conversations', failOnStatusCode: false }).its('status').should('eq', 200)
        cy.request({ url: '/api/growth/dashboard', failOnStatusCode: false }).its('status').should('eq', 403)

        cy.visit('/growth/leads')
        cy.contains('Leire Permiso Lead', { timeout: 20000 }).should('be.visible')
        cy.get('a[href="/growth/leads"]').should('exist')
      })
    })
  })
})
