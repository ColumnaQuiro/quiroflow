// The two configuration screens: what the AI receptionist is allowed to do,
// and the workflow builder that runs around it.

describe('Growth AI receptionist and automations', () => {
  before(() => {
    cy.seedStaffAccount().then((account) => {
      Cypress.env('growthAccount', account)
    })
  })

  beforeEach(() => {
    const account = Cypress.env('growthAccount')
    cy.login(account.email, account.password)
  })

  describe('AI receptionist', () => {
    it('shows the persona, what it knows, and what it may book', () => {
      cy.visit('/growth/receptionist?growth=1')

      cy.contains('Alba').should('be.visible')
      cy.contains('Warm and brief').should('be.visible')

      // The knowledge cards are what a system prompt gets built from.
      cy.contains('Services and prices').scrollIntoView().should('be.visible')
      cy.contains('Initial Assessment · 45 min · €55').scrollIntoView().should('be.visible')

      // And the cards that mirror data this app already holds say so, rather
      // than inviting the owner to keep a second copy that drifts.
      cy.contains('Synced from Billing · 4 services').scrollIntoView().should('be.visible')
      cy.contains('Synced from Calendar').scrollIntoView().should('be.visible')

      // Scoped to the chip, not a bare contains(): "Initial Assessment" also
      // appears in the services knowledge card further up the page.
      cy.contains('May book these appointment types').scrollIntoView().should('be.visible')
      cy.contains('Shockwave · off').scrollIntoView().should('be.visible')
    })

    it('spells out when it must stop and fetch a person', () => {
      cy.visit('/growth/receptionist?growth=1')

      cy.contains('Escalation rules').scrollIntoView().should('be.visible')
      cy.contains('Red-flag symptoms named → hand over now').scrollIntoView().should('be.visible')
      cy.contains('Insurer named → hand over now').scrollIntoView().should('be.visible')

      // A disconnected channel is visible here too, not only in the Inbox.
      cy.contains('WhatsApp · +34 931 22 04 88').scrollIntoView().should('be.visible')
      cy.contains('Reconnect').scrollIntoView().should('be.visible')
    })

    it('lets the owner try the persona without booking anything', () => {
      cy.visit('/growth/receptionist?growth=1')

      cy.contains('Try Alba').should('be.visible')
      cy.contains('Nothing is booked from here').should('be.visible')
      cy.contains('Test mode').should('be.visible')

      // "Why this reply" is the thing actually being tested: whether the
      // rules the owner set are the ones being used.
      cy.contains('Why this reply').scrollIntoView().should('be.visible')

      cy.get('input[placeholder*="patient"]').type('¿Abrís los sábados?')
      cy.contains('button', 'Send').click()
      cy.contains('¿Abrís los sábados?').should('be.visible')
      cy.contains('Test mode is not wired to a model yet').should('be.visible')
    })

    it('points an account without the tier at the upgrade screen', () => {
      cy.visit('/growth/receptionist?growth=0')

      cy.contains('The AI receptionist is part of the Growth tier.').should('be.visible')
      cy.contains('Try Alba').should('not.exist')
    })
  })

  describe('Automations', () => {
    it('draws the speed-to-lead workflow, branches and all', () => {
      cy.visit('/growth/automations?growth=1')

      cy.get('[data-test="node-trigger"]').should('contain', 'New lead from Meta Ads form')
      cy.get('[data-test="node-wa"]').should('contain', 'Send WhatsApp within 60s')
      cy.get('[data-test="node-wait10"]').should('contain', 'Wait 10 minutes')

      // The condition names both of its exits on the node itself.
      cy.get('[data-test="node-replied"]').within(() => {
        cy.contains('Replied?').should('be.visible')
        cy.contains('Yes · 61%').should('be.visible')
        cy.contains('No · 39%').should('be.visible')
      })

      // Both branches, and where they end up.
      cy.get('[data-test="node-ai-books"]').should('contain', 'AI qualifies and books')
      cy.get('[data-test="node-sms"]').should('contain', 'Send SMS')
      cy.get('[data-test="node-notify"]').should('contain', 'Notify front desk')
      cy.get('[data-test="node-end"]').should('contain', 'Ends · lead is booked')
    })

    it('connects the nodes with edges derived from where they actually are', () => {
      cy.visit('/growth/automations?growth=1')

      // One path per edge, and the fallback branch is the dashed one. Drawn
      // from node geometry rather than stored, so an edge cannot point at
      // where a node used to be.
      cy.get('[data-test="workflow-edges"] path').should('have.length', 8)
      cy.get('[data-test="workflow-edges"] path[stroke-dasharray]').should('have.length', 1)
    })

    it('configures the selected step, and says so when a type has no panel yet', () => {
      cy.visit('/growth/automations?growth=1')

      // The condition opens selected, because it is the only step with a
      // configuration panel written so far.
      cy.get('[data-test="node-config"]').within(() => {
        cy.contains('Condition · Replied?').should('be.visible')
        cy.contains('Lead replied on any channel').should('be.visible')
        cy.contains('Yes → AI qualifies and books').should('be.visible')
        cy.contains('251').should('be.visible')
      })

      cy.get('[data-test="node-wa"]').click()
      cy.get('[data-test="node-config"]').within(() => {
        cy.contains('Send WhatsApp within 60s').should('be.visible')
        cy.contains('Configuration for this step type is not built yet').should('be.visible')
      })
    })

    it('lists the other workflows and the chiro templates', () => {
      cy.visit('/growth/automations?growth=1')

      cy.get('[data-test="workflow-missed-call"]').should('contain', 'Missed-call text back')
      cy.get('[data-test="workflow-dormant"]').should('contain', '0 runs · paused')

      cy.contains('Chiro templates').scrollIntoView().should('be.visible')
      cy.contains('Texts within 30s of a missed call').scrollIntoView().should('be.visible')
    })

    it('points an account without the tier at the upgrade screen', () => {
      cy.visit('/growth/automations?growth=0')

      cy.contains('The automation builder is part of the Growth tier.').should('be.visible')
      cy.get('[data-test="node-trigger"]').should('not.exist')
    })
  })
})
