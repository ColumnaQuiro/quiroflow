// Settings > Online Booking hands a clinic the snippet for its own website.
//
// What is worth pinning is not that a box exists but what is inside it. The
// booking widget reads gclid/utm_* from its own query string, and an iframe
// src does not inherit the page's -- so an embed without embed.js records
// every booking as though it arrived from nowhere, the paid ones included.
// That is not a hypothetical: it was true of the clinic's own site for a
// week, 7 bookings with no campaign on any of them against 48 paid clicks to
// the page in the same window.
//
// So the assertion below is that the script tag is in the snippet. A snippet
// that quietly loses it is worse than no snippet, because it looks finished.

describe('The booking embed snippet', () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
    })
  })

  it('gives the clinic a snippet that carries the campaign', () => {
    cy.get('[data-test="booking-embed-card"]').should('be.visible')

    cy.get('[data-test="booking-embed-snippet"]')
      .invoke('val')
      .should((value) => {
        const snippet = String(value)
        // The container embed.js looks for, carrying this account's own slug
        // -- without it the script has nothing to build.
        expect(snippet).to.contain('data-quiroflow-booking')
        expect(snippet).to.contain('data-slug=')
        // The part that is easy to drop and expensive to drop.
        expect(snippet).to.contain('/embed.js')
        // Built from the origin the clinic is looking at, so the snippet is
        // right in development and on any future domain without anyone
        // remembering to change it. A hardcoded production URL would be
        // wrong here and nobody would notice until a clinic pasted it.
        expect(snippet).to.contain(window.location.origin)
      })
  })

  it('names the account in the snippet, not a placeholder', () => {
    // A clinic that pastes someone else's slug gets a working widget showing
    // the wrong clinic's calendar, which is the kind of mistake that is only
    // caught by a patient booking into it.
    cy.window()
      .then((win) => win.location.origin)
      .then(() => {
        cy.get('[data-test="booking-embed-snippet"]')
          .invoke('val')
          .should((value) => {
            const snippet = String(value)
            const slug = snippet.match(/data-slug="([^"]+)"/)?.[1]
            expect(slug, 'a slug is present').to.be.a('string')
            expect(slug).not.to.eq('')
            expect(slug).not.to.contain('slug')
          })
      })
  })
})
