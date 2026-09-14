// The leads pipeline: the board itself, its empty and loading states, and the
// drawer a card opens.
//
// Cypress cannot perform a real HTML5 drag, so the drag test fires the same
// events a browser would (dragstart on the card, dragover then drop on the
// target column). That is a faithful test of the handlers because none of
// them read dataTransfer -- the dragged lead is tracked in component state,
// which is also what makes the board work in browsers whose dataTransfer is
// restricted during dragover.

describe('Growth leads pipeline', () => {
  before(() => {
    cy.seedStaffAccount().then((account) => {
      Cypress.env('leadsAccount', account)
    })
  })

  beforeEach(() => {
    const account = Cypress.env('leadsAccount')
    cy.login(account.email, account.password)
  })

  it('shows the pipeline, including the crowded and empty stages', () => {
    cy.visit('/growth/leads?growth=1')

    cy.contains('Valeria Ocampo').should('be.visible')
    cy.contains('AI handling').should('be.visible')

    // A stage holding more leads than the board draws says so rather than
    // silently truncating.
    cy.get('[data-test="lead-column-contacted"] [data-test="lead-count"]').should('have.text', '23')
    cy.contains('+16 more').scrollIntoView().should('be.visible')

    // And an empty stage explains itself instead of rendering a blank gutter.
    // Seven stages are wider than the viewport, so the rightmost ones have to
    // be scrolled to before Cypress will call them visible.
    cy.contains('No lost leads').scrollIntoView().should('be.visible')

    // Booked cards carry the appointment they hold in the real calendar --
    // the whole claim the tier makes.
    cy.contains('Initial Assessment · Mon 15, 10:30 · Sants').scrollIntoView().should('be.visible')
  })

  it('moves a lead between stages on drop, and keeps the stage counts honest', () => {
    cy.visit('/growth/leads?growth=1')

    // Asserted against the count badge itself, not the column's text: a bare
    // contains('9') also matches the "€4,905 est." beside it.
    cy.get('[data-test="lead-column-qualified"] [data-test="lead-count"]').should('have.text', '5')
    cy.get('[data-test="lead-column-booked"] [data-test="lead-count"]').should('have.text', '9')

    cy.get('[data-test="lead-column-qualified"]').contains('button', 'Rubén Ortega').trigger('dragstart')
    cy.get('[data-test="lead-column-booked"]').trigger('dragover').trigger('drop')

    cy.get('[data-test="lead-column-booked"]').contains('Rubén Ortega').should('exist')
    cy.get('[data-test="lead-column-qualified"]').contains('Rubén Ortega').should('not.exist')
    cy.get('[data-test="lead-column-booked"] [data-test="lead-count"]').should('have.text', '10')
    cy.get('[data-test="lead-column-qualified"] [data-test="lead-count"]').should('have.text', '4')
  })

  it('filters the board by name without rewriting the stage totals', () => {
    cy.visit('/growth/leads?growth=1')

    // Wait for a card before typing. The filter bar is server-rendered, so
    // the input exists well before Vue binds v-model to it -- typing into it
    // first sends the keystrokes nowhere, and the board then renders
    // unfiltered. A rendered card only appears after mount, so it is proof
    // hydration is done. This failed three times running in CI, where the
    // window is wide enough to lose the race every time.
    cy.contains('button', 'Rubén Ortega').should('be.visible')

    cy.get('input[type="search"]').should('not.be.disabled').type('valeria')
    cy.contains('Valeria Ocampo').should('be.visible')
    cy.contains('Rubén Ortega').should('not.exist')

    // The count describes the stage, not the search.
    cy.get('[data-test="lead-column-contacted"] [data-test="lead-count"]').should('have.text', '23')
  })

  it('opens the lead drawer, ending at Convert to patient', () => {
    cy.visit('/growth/leads?growth=1')
    cy.contains('button', 'Valeria Ocampo').click()

    cy.get('[role="dialog"]').within(() => {
      cy.contains('LEAD-2026-0918').should('be.visible')

      // The timeline is the argument: form, AI conversation, decision,
      // a real calendar booking, reminder, and the visit still pending.
      cy.contains('Meta lead form submitted').should('be.visible')
      cy.contains('Hi Valeria, this is Alba from Clínica Sants').should('be.visible')
      cy.contains('Qualified · musculoskeletal, no red flags').should('be.visible')
      cy.contains('Initial Assessment · Mon 15 Sep, 19:30 · Room 2').should('be.visible')
      cy.contains('Showed for appointment').should('be.visible')

      cy.contains('Campaign').should('be.visible')
      cy.contains('Cost per lead').should('be.visible')

      cy.contains('button', 'Convert to patient').should('be.visible')
    })

    cy.get('body').type('{esc}')
    cy.get('[role="dialog"]').should('not.exist')
  })

  it('shows the set-up checklist to a clinic with no leads yet', () => {
    cy.visit('/growth/leads?growth=1&state=empty')

    cy.contains('No leads yet').should('be.visible')
    cy.contains('a', 'Connect WhatsApp').should('have.attr', 'href', '/settings/whatsapp')
    cy.contains('Public booking page live').should('be.visible')
    cy.contains('Set-up').should('be.visible')

    // Nothing to drag or open in this state.
    cy.get('[data-test="lead-column-new"]').should('not.exist')
  })

  it('draws the board shell while the leads are still loading', () => {
    cy.visit('/growth/leads?growth=1&state=loading')

    cy.get('[data-test="leads-skeleton"]').should('exist')
    // The shell stands in for the board, so neither must be on screen at once.
    cy.get('[data-test="lead-column-new"]').should('not.exist')
    // Decorative: a screen reader should be told nothing is here yet.
    cy.get('[data-test="leads-skeleton"]').should('have.attr', 'aria-hidden', 'true')
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/leads?growth=0')

    cy.contains('Leads are part of the Growth tier.').should('be.visible')
    cy.contains('a', 'See what Growth adds').should('have.attr', 'href', '/growth')
    cy.get('[data-test="lead-column-new"]').should('not.exist')
  })
})
