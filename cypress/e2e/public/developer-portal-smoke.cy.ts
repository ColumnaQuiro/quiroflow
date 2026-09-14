import { DEV_PORTAL_SLUGS } from '../../../utils/devPortal'

describe('Developer portal', () => {
  it('smoke-tests the developer portal, at both of the URL shapes it is served at', () => {
    cy.clearCookies()

    // /developers is the section root and has no content of its own.
    cy.visit('/developers')
    cy.location('pathname').should('eq', '/developers/introduction')

    for (const slug of DEV_PORTAL_SLUGS) {
      cy.visit(`/developers/${slug}`)
      cy.location('pathname').should('eq', `/developers/${slug}`)
      cy.contains('a', 'Introduction').should('be.visible')

      // The prefix-free alias, which is what developers.quiroflow.com serves.
      // Registered by the pages:extend hook in nuxt.config.ts -- if that
      // stops working the docs subdomain 404s, and nothing else would catch
      // it because the app host keeps working either way.
      cy.visit(`/${slug}`)
      cy.location('pathname').should('eq', `/${slug}`)
      cy.contains('a', 'Introduction').should('be.visible')
    }
  })

  // robots.txt is host-dependent (server/routes/robots.txt.get.ts) and a
  // regression here is invisible: the portal keeps rendering perfectly while
  // quietly being uncrawlable, which is how it shipped the first time.
  it('serves robots.txt and the sitemap per host', () => {
    cy.request('/robots.txt').then((res) => {
      // The app host invites the crawl on purpose. It said `Disallow: /`
      // until the login page turned up in Google anyway: a disallowed URL
      // still gets indexed when something links to it, and the crawler never
      // fetches the page, so the noindex inside it is never read. The refusal
      // is the X-Robots-Tag header below, which only works if the crawl is
      // allowed to happen.
      expect(res.body, 'app host must be crawlable for its noindex to be seen').to.contain('Allow: /')
      expect(res.body).not.to.contain('Disallow: /')
    })
    cy.request({ url: '/sitemap.xml', failOnStatusCode: false }).its('status').should('eq', 404)

    // The docs subdomain, faked with a Host header -- the app is host-aware,
    // not port-aware, so this is the same code path developers.quiroflow.com hits.
    cy.request({ url: '/robots.txt', headers: { Host: 'developers.localtest.me' } }).then((res) => {
      expect(res.body, 'docs host must be crawlable').to.contain('Allow: /')
      expect(res.body).not.to.contain('Disallow: /')
      expect(res.body).to.contain('Sitemap: https://developers.quiroflow.com/sitemap.xml')
    })

    cy.request({ url: '/sitemap.xml', headers: { Host: 'developers.localtest.me' } }).then((res) => {
      expect(res.status).to.eq(200)
      for (const slug of DEV_PORTAL_SLUGS) {
        expect(res.body, `sitemap lists /${slug}`).to.contain(`https://developers.quiroflow.com/${slug}<`)
      }
    })
  })

  // The half that actually keeps the app out of the index, and the half a
  // rendering test can never notice is missing.
  it('sends noindex from the app host and never from the docs host', () => {
    cy.request('/login').then((res) => {
      expect(res.headers['x-robots-tag'], 'app host refuses indexing').to.contain('noindex')
    })
    // Not just HTML: an invoice PDF is served from this host too, and a meta
    // tag cannot say anything about a PDF.
    cy.request({ url: '/api/invoices/00000000-0000-0000-0000-000000000000/pdf', failOnStatusCode: false }).then((res) => {
      expect(res.headers['x-robots-tag']).to.contain('noindex')
    })
    cy.request({ url: '/authentication', headers: { Host: 'developers.localtest.me' } }).then((res) => {
      expect(res.headers['x-robots-tag'], 'the docs are meant to rank').to.be.undefined
    })
  })
})
