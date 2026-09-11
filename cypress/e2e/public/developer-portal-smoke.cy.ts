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
      expect(res.body, 'app host stays fully disallowed').to.contain('Disallow: /')
      expect(res.body).not.to.contain('Allow: /')
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
})
