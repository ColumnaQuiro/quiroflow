// public/embed.js -- the script a clinic puts on its landing page so the
// booking widget it embeds can still see which ad sent the visitor.
//
// This is tested against the real file served by the app, not a copy: the
// whole failure it exists to fix was a boundary nobody could see from either
// side, and a unit test of a re-implementation would have reproduced neither.
//
// Each case builds its own host page inside the app origin, because that is
// what a clinic's landing page is from the script's point of view -- a
// document with a query string on it and an iframe somewhere below.

/** Injects embed.js into the page under test and waits for it to run. */
function loadEmbedScript() {
  cy.document().then((doc) => {
    const script = doc.createElement('script')
    script.src = '/embed.js'
    doc.body.appendChild(script)
  })
}

describe('Booking embed attribution', () => {
  it('builds an iframe that carries the landing page campaign params', () => {
    // A Google click as it actually arrives: gclid plus the campaign's utms.
    cy.visit('/login?gclid=TEST-GCLID-123&utm_source=google&utm_campaign=cq_02_quiropractico')

    cy.document().then((doc) => {
      const container = doc.createElement('div')
      container.setAttribute('data-quiroflow-booking', '')
      container.setAttribute('data-slug', 'embed-test-clinic')
      container.setAttribute('data-type', '91a6b6d9-1bb3-4a66-aa8c-f17ee66e4d1e')
      doc.body.appendChild(container)
    })
    loadEmbedScript()

    cy.get('[data-quiroflow-booking] iframe')
      .should('have.attr', 'src')
      .then((src) => {
        const url = new URL(String(src))
        expect(url.pathname).to.eq('/book/embed-test-clinic')
        // The appointment type is the reason the embed exists and must
        // survive having the campaign appended to it.
        expect(url.searchParams.get('type')).to.eq('91a6b6d9-1bb3-4a66-aa8c-f17ee66e4d1e')
        expect(url.searchParams.get('gclid')).to.eq('TEST-GCLID-123')
        expect(url.searchParams.get('utm_source')).to.eq('google')
        expect(url.searchParams.get('utm_campaign')).to.eq('cq_02_quiropractico')
      })
  })

  it('rewrites an iframe the clinic already had on the page', () => {
    // The path that matters for the live site: the embed was pasted in
    // months ago and the clinic adds nothing but the script tag.
    cy.visit('/login?gclid=ALREADY-EMBEDDED')

    cy.document().then((doc) => {
      const iframe = doc.createElement('iframe')
      iframe.id = 'existing-embed'
      iframe.setAttribute('src', '/book/embed-test-clinic?type=70a38844-ebb9-4a42-b59e-dd6720160e0d')
      doc.body.appendChild(iframe)
    })
    loadEmbedScript()

    cy.get('#existing-embed')
      .should('have.attr', 'data-quiroflow-attributed')
      .then(() => {
        cy.get('#existing-embed')
          .invoke('attr', 'src')
          .then((src) => {
            const url = new URL(String(src), window.location.origin)
            expect(url.searchParams.get('gclid')).to.eq('ALREADY-EMBEDDED')
            expect(url.searchParams.get('type')).to.eq('70a38844-ebb9-4a42-b59e-dd6720160e0d')
          })
      })
  })

  it('reads a campaign whose key arrived with a leading space', () => {
    // `?+utm_campaign=` decodes to a parameter named " utm_campaign", which
    // is what the live Meta ad URL actually sends. The widget already
    // normalises for this; the forwarder has to as well, or the fix is
    // undone on this side of the boundary before the widget ever sees it.
    cy.visit('/login?+utm_campaign=ad_imagen&utm_source=Facebook')

    cy.document().then((doc) => {
      const container = doc.createElement('div')
      container.setAttribute('data-quiroflow-booking', '')
      container.setAttribute('data-slug', 'embed-test-clinic')
      doc.body.appendChild(container)
    })
    loadEmbedScript()

    cy.get('[data-quiroflow-booking] iframe')
      .should('have.attr', 'src')
      .then((src) => {
        expect(new URL(String(src)).searchParams.get('utm_campaign')).to.eq('ad_imagen')
      })
  })

  it('leaves an existing embed alone when there is no campaign to add', () => {
    // An organic visitor must not cost the clinic a second iframe load to
    // record nothing -- assigning src reloads it.
    cy.visit('/login')

    cy.document().then((doc) => {
      const iframe = doc.createElement('iframe')
      iframe.id = 'untouched-embed'
      iframe.setAttribute('src', '/book/embed-test-clinic?type=70a38844-ebb9-4a42-b59e-dd6720160e0d')
      doc.body.appendChild(iframe)
    })
    loadEmbedScript()

    // Give the script the same window it would have had to act.
    cy.get('#untouched-embed').should('exist')
    cy.wait(250)
    cy.get('#untouched-embed')
      .should('not.have.attr', 'data-quiroflow-attributed')
      .and('have.attr', 'src', '/book/embed-test-clinic?type=70a38844-ebb9-4a42-b59e-dd6720160e0d')
  })

  it('forwards only the campaign keys, not whatever else is on the URL', () => {
    // A clinic's landing page URL is not ours and may carry things that must
    // not be replayed into another origin -- a token from an email link, a
    // prefilled address. The allowlist is the guarantee.
    cy.visit('/login?gclid=KEEP-THIS&session_token=SECRET-DO-NOT-FORWARD&email=someone%40example.com')

    cy.document().then((doc) => {
      const container = doc.createElement('div')
      container.setAttribute('data-quiroflow-booking', '')
      container.setAttribute('data-slug', 'embed-test-clinic')
      doc.body.appendChild(container)
    })
    loadEmbedScript()

    cy.get('[data-quiroflow-booking] iframe')
      .should('have.attr', 'src')
      .then((src) => {
        const url = new URL(String(src))
        expect(url.searchParams.get('gclid')).to.eq('KEEP-THIS')
        expect(url.searchParams.has('session_token')).to.eq(false)
        expect(url.searchParams.has('email')).to.eq(false)
      })
  })
})
