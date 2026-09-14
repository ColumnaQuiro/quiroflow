// The Growth tier upgrades the existing Inbox instead of shipping a second
// one. Two things therefore matter here, and the first matters more:
//
//   1. Without the tier, /inbox is exactly what it was. This page serves real
//      clinics today, so the no-tier case is asserted first and hardest.
//   2. With the tier, lead conversations join the same list, carry AI state,
//      and can be taken off the AI by a person.

describe('Growth in the shared Inbox', () => {
  before(() => {
    cy.seedStaffAccount().then((account) => {
      Cypress.env('inboxAccount', account)
    })
  })

  beforeEach(() => {
    const account = Cypress.env('inboxAccount')
    cy.login(account.email, account.password)
  })

  it('leaves the Inbox untouched for an account without the tier', () => {
    cy.visit('/inbox?growth=0')

    cy.contains('Inbox').should('be.visible')

    // No lead rows, no AI chrome, nothing from the tier at all.
    cy.get('[data-test="lead-row"]').should('not.exist')
    cy.get('[data-test="filter-ai-handling"]').should('not.exist')
    cy.get('[data-test="filter-needs-human"]').should('not.exist')

    // The filters the base plan has always had are still there.
    cy.contains('button', 'Awaiting us').should('be.visible')
    cy.contains('button', 'Awaiting patient').should('be.visible')
  })

  it('adds lead conversations to the same list once the tier is on', () => {
    cy.visit('/inbox?growth=1')

    cy.get('[data-test="lead-row"]').should('have.length.at.least', 4)
    cy.contains('[data-test="lead-row"]', 'Camila Restrepo').should('be.visible')

    // Channels the base plan does not have.
    cy.contains('[data-test="lead-row"]', 'Instagram').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'Web chat').should('be.visible')

    // And the states that decide who answers.
    cy.contains('[data-test="lead-row"]', 'AI handling').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'Needs human').should('be.visible')
  })

  it('filters to just what the AI is handling', () => {
    cy.visit('/inbox?growth=1')

    cy.get('[data-test="filter-ai-handling"]').click()
    cy.get('[data-test="lead-row"]').should('have.length', 2)
    cy.contains('[data-test="lead-row"]', 'Sofía Ramírez').should('not.exist')

    cy.get('[data-test="filter-needs-human"]').click()
    cy.contains('[data-test="lead-row"]', 'Sofía Ramírez').should('be.visible')
    cy.contains('[data-test="lead-row"]', 'Camila Restrepo').should('not.exist')
  })

  it('lands from the sidebar with the AI filter already applied', () => {
    cy.visit('/inbox?growth=1&ai=handling')

    cy.get('[data-test="filter-ai-handling"]').should('have.class', 'border-brand')
    cy.get('[data-test="lead-row"]').should('have.length', 2)
  })

  it('locks the composer while the AI is replying, and opens it on take over', () => {
    // Opened from the AI-handling view on purpose: taking over moves the
    // thread out of that filter, and it must not vanish from under the person
    // who is mid-reply.
    cy.visit('/inbox?growth=1&ai=handling')
    cy.contains('[data-test="lead-row"]', 'Camila Restrepo').click()

    cy.get('[data-test="lead-thread"]').within(() => {
      cy.contains('AI is handling this conversation').should('be.visible')
      cy.contains('Composer locked while the AI is replying').should('be.visible')
    })
    cy.get('[data-test="lead-composer"]').should('not.exist')

    cy.get('[data-test="take-over"]').click()

    cy.get('[data-test="lead-thread"]').within(() => {
      cy.contains('AI paused').should('be.visible')
      cy.contains('AI is handling this conversation').should('not.exist')
    })
    cy.get('[data-test="lead-composer"]').should('be.visible')

    // A reply is appended to the thread, and says plainly that nothing was
    // delivered -- there is no messaging API behind a lead thread yet.
    cy.get('[data-test="lead-composer"] textarea').type('Te confirmo la cita.')
    cy.get('[data-test="lead-composer"]').contains('button', 'Send').click()
    cy.get('[data-test="lead-thread"]').contains('Te confirmo la cita.').should('be.visible')
    cy.get('[data-test="lead-thread"]').contains('not sent (preview)').should('be.visible')

    cy.get('[data-test="hand-back"]').click()
    cy.contains('AI is handling this conversation').should('be.visible')
  })

  it('shows the lead context rail beside the thread', () => {
    cy.viewport(1440, 900)
    cy.visit('/inbox?growth=1')
    cy.contains('[data-test="lead-row"]', 'Camila Restrepo').click()

    cy.get('[data-test="lead-rail"]').within(() => {
      cy.contains('In QuiroFlow').should('be.visible')
      // The bridge the tier sells: what this person is not yet, inside the
      // practice.
      cy.contains('Patient record').should('be.visible')
      cy.contains('Not created').should('be.visible')
      cy.contains('Quick book').should('be.visible')
    })
  })
})
