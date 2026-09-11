import { NOT_SWEPT_HERE, STATIC_AUTHENTICATED_PAGES, UNAUTHENTICATED_PAGES } from '../../support/pageInventory'

describe('Pages reachable without signing in', () => {
  it('smoke-tests the unauthenticated pages', () => {
    cy.clearCookies()

    // '/' deliberately redirects straight to '/login' (pages/index.vue) --
    // it has no standalone content for a logged-out visitor.
    cy.visit('/')
    cy.location('pathname').should('eq', '/login')

    for (const path of UNAUTHENTICATED_PAGES) {
      cy.visit(path)
      cy.location('pathname').should('eq', path)
    }
  })

  // Visits nothing -- it just compares pages/ against the inventory in
  // cypress/support/pageInventory.ts, so a page added without a decision
  // about how it gets tested fails here instead of shipping untested. It
  // checks every list at once even though the sweeps that use them are split
  // across specs, which is why those lists live in one shared module.
  //
  // Dynamic routes are excluded: the authenticated sweep already visits the
  // ones that matter with real fixtures ([id] for patients/billing/roles),
  // and the token-based ones ([token], [slug]) can't be visited without a
  // live token.
  it('has every page in pages/ either swept somewhere or explicitly accounted for', () => {
    cy.task<string[]>('app:pageRoutes').then((routes) => {
      const accountedFor = new Set([...STATIC_AUTHENTICATED_PAGES, ...UNAUTHENTICATED_PAGES, ...Object.keys(NOT_SWEPT_HERE)])
      const unaccounted = routes.filter((route) => !route.includes('[') && !accountedFor.has(route))

      expect(
        unaccounted,
        'pages with no e2e coverage -- add them to APP_PAGES or SETTINGS_PAGES in cypress/support/pageInventory.ts, or to NOT_SWEPT_HERE with the reason',
      ).to.deep.eq([])
    })
  })
})
