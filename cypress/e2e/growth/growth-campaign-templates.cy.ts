// Starting from a template (Automations > Templates, formerly Campaigns).
//
// PracticeHub's API has no campaigns endpoint and its exports do not carry
// them, so a clinic arriving from PracticeHub starts as blank as any other.
//
// What earns a test is the round trip and the safety property: an automation
// created from a template is exactly the one chosen, and it arrives PAUSED --
// these reach real patients, and a set that started firing because someone
// wanted to see what the button did would be a bad way to find out.
interface Row {
  id: string
  name: string
  enabled: boolean
  actions: { action_type: string; config: Record<string, any> }[]
}

describe('Automation templates', () => {
  it('creates the chosen one, paused, with the clinic filled in', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/automations')

      cy.get('[data-test="empty"]').should('contain', 'No automations yet')
      cy.get('[data-test="empty-templates"]').click()
      cy.get('[data-test="templates-dialog"]').should('be.visible')
      cy.get('[data-test="template-first-visit-booked"]').click()
      // Straight into the builder, to read it before switching it on.
      cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
      cy.get('[data-test="automation-enabled"]').should('have.attr', 'aria-checked', 'false')

      cy.task<Row[]>('db:latestAutomationRules', { accountId: account.accountId }).then((rows) => {
        expect(rows, 'only the one chosen').to.have.length(1)
        const welcome = rows[0]!
        expect(welcome.name).to.eq('First visit booked')
        expect(welcome.enabled, 'arrives paused').to.eq(false)
        expect(welcome.actions, 'one email step').to.have.length(1)
        expect(welcome.actions[0]!.action_type).to.eq('email')
        // The clinic name is written in at creation, so staff open finished
        // copy rather than a placeholder...
        expect(welcome.actions[0]!.config.subject).to.contain('Main Location')
        expect(welcome.actions[0]!.config.subject).to.not.contain('{{clinic_name}}')
        // ...while the per-recipient merge fields survive untouched.
        expect(welcome.actions[0]!.config.body).to.contain('{{next_appointment}}')
      })

      // A flow template arrives as its whole tree, paused too.
      cy.visit('/automations')
      // The row renders from the list's own request, after mount: the page is
      // hydrated and the button will answer a click.
      cy.contains('First visit booked').should('be.visible')
      cy.get('[data-test="open-templates"]').click()
      cy.get('[data-test="template-win-back-after-visit"]').click()
      cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)
      cy.task<Row[]>('db:latestAutomationRules', { accountId: account.accountId }).then((rows) => {
        expect(rows).to.have.length(2)
        const flow = rows.find((r) => r.name === 'Win back after the visit')!
        expect(flow.enabled).to.eq(false)
        expect(flow.actions.map((a) => a.action_type).sort()).to.deep.eq(['branch', 'delay', 'notify', 'tag', 'wait_until', 'whatsapp_template'])
      })
      // What it still needs is named on the canvas, not discovered later.
      cy.get('[data-test="canvas-fit"]').click()
      cy.get('[data-test="node-problem"]').should('exist')
    })
  })

  it('marks what is already there rather than offering a duplicate', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/automations')
      cy.get('[data-test="empty"]').should('be.visible')
      cy.get('[data-test="open-templates"]').click()
      cy.get('[data-test="template-first-visit-booked"]').click()
      cy.location('pathname').should('match', /^\/automations\/[0-9a-f-]{36}$/)

      cy.visit('/automations')
      cy.contains('First visit booked').should('be.visible')
      cy.get('[data-test="open-templates"]').click()
      cy.get('[data-test="template-first-visit-booked"]').should('contain', 'already added')
      cy.get('[data-test="template-first-visit-cancelled"]').should('not.contain', 'already added')
    })
  })
})
