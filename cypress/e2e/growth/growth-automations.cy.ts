// The automations workflow canvas.
//
// It used to draw fixtures: seven invented workflows with invented run
// counts, credited in the header to a person who does not work here. Those
// assertions tested that the fixture still said what the fixture said, which
// is why none of them noticed the page was fiction. It now draws the
// account's real automation_rules, so these test that what is on the canvas
// is what is in the database.

interface SeededAccount {
  email: string
  password: string
  accountId: string
}

describe('Growth automations', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  it('says there is nothing rather than drawing something', () => {
    // The state every clinic starts in, and the one the fixtures hid.
    cy.visit('/growth/automations?growth=1')
    cy.get('[data-test="no-workflows"]').should('contain', 'No automations yet')
    cy.get('[data-test="node-0"]').should('not.exist')
  })

  it('draws a real rule as its trigger and steps, in order', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      actions: [
        { type: 'whatsapp_template', config: { template_name: 'welcome_1', template_language: 'es', header: { type: 'video', storage_path: 'x/y.mp4' } } },
        { type: 'delay', config: { delay_minutes: 1440 } },
        { type: 'whatsapp_template', config: { template_name: 'welcome_day_2', template_language: 'es' } },
      ],
    })

    cy.visit('/growth/automations?growth=1')

    cy.get('[data-test="node-0"]').should('contain', 'New lead arrives')
    cy.get('[data-test="node-1"]').should('contain', 'welcome_1')
    // The header is named on the node, because a template that needs one and
    // has not got one is a send that fails.
    cy.get('[data-test="node-1"]').should('contain', 'video header')
    // Minutes are shown in the unit a person would say them in.
    cy.get('[data-test="node-2"]').should('contain', 'Wait 1 day')
    cy.get('[data-test="node-3"]').should('contain', 'welcome_day_2')
    cy.get('[data-test="node-4"]').should('not.exist')
  })

  it('connects the nodes with edges derived from where they actually are', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      actions: [
        { type: 'whatsapp_template', config: { template_name: 'one' } },
        { type: 'whatsapp_template', config: { template_name: 'two' } },
      ],
    })

    cy.visit('/growth/automations?growth=1')

    // One path per gap between nodes, computed from node geometry rather
    // than hand-written coordinates -- scoped to the edge layer so this
    // cannot accidentally count the sidebar's icons.
    cy.get('[data-test="workflow-edges"]').find('path').should('have.length', 2)
  })

  it('calls a test run a test run, not enabled', () => {
    // The single most misleading word this screen could show: a rule that
    // records instead of sending is neither enabled nor paused.
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      dryRun: true,
      actions: [{ type: 'whatsapp_template', config: { template_name: 'welcome_1' } }],
    })

    cy.visit('/growth/automations?growth=1')
    cy.get('[data-test="workflow-state"]').should('contain', 'records, does not send')
    cy.get('[data-test="workflow-state"]').should('not.contain', 'Enabled')
  })

  it('counts runs from what actually ran', () => {
    cy.task('db:createAutomationRule', {
      accountId: account.accountId,
      triggerEvent: 'lead.created',
      actions: [{ type: 'whatsapp_template', config: { template_name: 'welcome_1' } }],
    })

    cy.visit('/growth/automations?growth=1')
    // Zero says zero. A new automation has not run, and that is worth
    // seeing rather than dressing up.
    cy.contains('0 runs · 30d').should('be.visible')
  })

  it('sends editing to Campaigns rather than offering a second editor', () => {
    cy.visit('/growth/automations?growth=1')
    cy.contains('a', 'Edit in Campaigns').should('have.attr', 'href', '/campaigns')
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/automations?growth=0')
    cy.contains('part of the Growth tier').should('be.visible')
  })
})
