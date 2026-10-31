// plugins/patient-page-prefetch.server.ts -- the pages a patient opens from a
// link must not tell their phone to prefetch the staff app. Read from the
// server-rendered HTML, which is where the hints are, so no clinic is needed:
// an unknown slug or token renders the same shell.

const PATIENT_PAGES = ['/book/no-such-clinic', '/regalo/no-such-clinic', '/valorar/no-such-token', '/doc/no-such-token']

describe('Prefetch hints on patient pages', () => {
  for (const path of PATIENT_PAGES) {
    it(`${path} prefetches nothing`, () => {
      cy.request({ url: path, failOnStatusCode: false }).then(({ body }) => {
        expect(body).to.contain('<script type="module"')
        expect(body).not.to.contain('rel="prefetch"')
      })
    })
  }

  it('the booking page still preloads its own code', () => {
    // The hints that remain are the ones this visit needs. When the page's
    // chunk drops out of the build manifest (a lazy child sharing its modules
    // did that), the server sends only the entry's and the page's code is
    // found one round trip later, after the entry has run.
    cy.request({ url: '/book/no-such-clinic', failOnStatusCode: false }).then(({ body }) => {
      expect(body.match(/rel="modulepreload"/g) ?? []).to.have.length.greaterThan(1)
    })
  })

  it('staff pages keep theirs', () => {
    // After signing in comes the default layout, which is what the hints
    // fetch ahead of time.
    cy.request('/login').its('body').should('contain', 'rel="prefetch"')
  })
})
