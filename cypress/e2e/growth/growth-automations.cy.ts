// The automations workflow builder.
//
// The AI receptionist used to be tested here too, against a fixture. It has
// real configuration storage now, so those assertions moved to
// growth-receptionist.cy.ts rather than being kept alongside a screen they no
// longer describe.

describe('Growth automations', () => {
  before(() => {
    cy.seedStaffAccount().then((account) => {
      Cypress.env('growthAccount', account)
    })
  })

  beforeEach(() => {
    const account = Cypress.env('growthAccount')
    cy.login(account.email, account.password)
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
