// Reputation, plus the dark-theme pass across the whole tier.
//
// The dark case gets its own test rather than a note in a PR because it is
// the claim the design made -- "design one artboard in dark to prove the
// palette flips" -- and the thing most likely to rot silently, since nobody
// reviews in dark by default. scripts/check-theme-tokens.mjs guards the
// static half (no hardcoded colours); this guards the rendered half.

const GROWTH_PAGES = ['/growth', '/growth/leads', '/growth/receptionist', '/growth/automations', '/growth/reputation']

describe('Growth reputation', () => {
  before(() => {
    cy.seedStaffAccount().then((account) => {
      Cypress.env('repAccount', account)
    })
  })

  beforeEach(() => {
    const account = Cypress.env('repAccount')
    cy.login(account.email, account.password)
  })

  it('summarises the rating, its spread and where it is heading', () => {
    cy.visit('/growth/reputation?growth=1')

    cy.contains('4.8').should('be.visible')
    cy.contains('412 reviews · +38 this year').should('be.visible')
    cy.contains('12-month trend').should('be.visible')
    cy.contains('4.5 → 4.8').should('be.visible')

    // Stars are drawn from the number, so they carry a real label rather than
    // being a string of glyphs a screen reader has to guess at.
    cy.get('[role="img"][aria-label="4.8 out of 5"]').should('exist')
  })

  it('holds an AI reply back for approval, and says what happens if nobody acts', () => {
    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="pending-reply"]').within(() => {
      cy.contains('AI drafted a reply · needs approval').should('be.visible')
      cy.contains('Jordi Puigdemont').should('be.visible')
      cy.contains('Mixed sentiment').should('be.visible')

      // The draft answers both halves of a mixed review, which is the point
      // of showing the review above it.
      cy.contains('La espera de 25 minutos no es aceptable').should('be.visible')

      // Doing nothing is itself a decision here, and the card says so.
      cy.contains('Auto-posts in 22 h unless you edit it').should('be.visible')
    })
  })

  it('confirms what happened when the draft is approved or discarded', () => {
    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="discard-reply"]').click()
    cy.get('[data-test="pending-reply"]').within(() => {
      cy.contains('Discarded. Nothing was posted.').should('be.visible')
      cy.contains('Auto-posts in 22 h').should('not.exist')
    })

    cy.reload()
    cy.get('[data-test="approve-reply"]').click()
    cy.get('[data-test="pending-reply"]').contains('Approved and posted.').should('be.visible')
  })

  it('shows the reviews and where the requests come from', () => {
    cy.visit('/growth/reputation?growth=1')

    cy.get('[data-test="review-card"]').should('have.length', 5)
    cy.contains('Daniel Okonkwo').scrollIntoView().should('be.visible')
    cy.contains('Replied by AI · approved by Marta Ferrer').scrollIntoView().should('be.visible')

    cy.contains('Review request funnel').scrollIntoView().should('be.visible')
    cy.contains('Requests sent').should('be.visible')
    cy.contains('Left a review').should('be.visible')

    // The funnel names the automation doing the sending, and links to it.
    cy.contains('Post-visit review request').scrollIntoView().should('be.visible')
    cy.contains('a', 'Open in Automations').should('have.attr', 'href', '/growth/automations')

    // A negative theme is not dressed in the same neutral chip as the praise.
    cy.contains('Waiting time · 9').scrollIntoView().should('be.visible')
  })

  it('points an account without the tier at the upgrade screen', () => {
    cy.visit('/growth/reputation?growth=0')

    cy.contains('Reputation is part of the Growth tier.').should('be.visible')
    cy.get('[data-test="review-card"]').should('not.exist')
  })

  describe('dark theme', () => {
    for (const path of GROWTH_PAGES) {
      it(`flips the palette on ${path}`, () => {
        cy.visit(`${path}?growth=1`, {
          onBeforeLoad(win) {
            win.localStorage.setItem('quiroflow-theme', 'dark')
          },
        })

        cy.get('html').should('have.attr', 'data-theme', 'dark')

        // The page surface must actually be dark, not merely themed. Parsing
        // the channels rather than matching a literal colour, so this keeps
        // working if the dark palette is retuned.
        cy.get('body').should(($body) => {
          const bg = getComputedStyle($body[0]).backgroundColor
          const [r, g, b] = bg.match(/\d+/g)!.map(Number)
          const luminance = (r! + g! + b!) / 3
          expect(luminance, `page background on ${path} should be dark, got ${bg}`).to.be.lessThan(90)
        })
      })
    }
  })
})
