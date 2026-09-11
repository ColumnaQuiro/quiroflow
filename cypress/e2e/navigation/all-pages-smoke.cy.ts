import { DEV_PORTAL_SLUGS } from '../../../utils/devPortal'

const STATIC_AUTHENTICATED_PAGES = [
  '/account',
  '/dashboard',
  '/calendar',
  '/campaigns',
  '/care-plan-alerts',
  '/patients',
  '/practitioner',
  '/recalls',
  '/waitlist',
  '/billing',
  '/billing/new',
  '/reports',
  '/reports/appointment-distribution',
  '/reports/custom',
  '/reports/data-exports',
  '/reports/daily-transactions',
  '/reports/debtors',
  '/reports/income-performance',
  '/reports/income',
  '/reports/memberships',
  '/reports/scheduled-reminders',
  '/reports/statistics',
  '/reports/upcoming-visits',
  '/settings',
  '/settings/app',
  '/settings/appointment-types',
  '/settings/clinics',
  '/settings/communications-general',
  '/settings/developers',
  '/settings/docs',
  '/settings/fiscal-data',
  '/settings/import',
  '/settings/invoice-settings',
  '/settings/memberships',
  '/settings/migrate-attachments',
  '/settings/modalities',
  '/settings/compress-files',
  '/settings/new-patient-fields',
  '/settings/online-booking',
  '/settings/packages',
  '/settings/patient-app',
  '/settings/payment-methods',
  '/settings/payments',
  '/settings/practitioners',
  '/settings/referral-sources',
  '/settings/reschedule-reasons',
  '/settings/roles',
  '/settings/rooms',
  '/settings/saved-replies',
  '/settings/services',
  '/settings/team',
  '/settings/webhooks',
  '/settings/whatsapp',
]

// The developer portal (pages/developers/*) is public documentation, so it
// sweeps unauthenticated. Derived from the same list that builds the portal's
// sidebar and its prefix-free alias routes, so a page added there is covered
// here automatically rather than tripping the guard test below.
const DEV_PORTAL_PAGES = DEV_PORTAL_SLUGS.map((slug) => `/developers/${slug}`)

const UNAUTHENTICATED_PAGES = ['/login', '/signup', '/forgot-password', ...DEV_PORTAL_PAGES]

// Routes this spec deliberately doesn't sweep, each for a reason the guard
// test below re-checks. Anything not here and not in one of the lists above
// makes that test fail, so a newly added page can't quietly go uncovered
// the way 17 of them already had.
const NOT_SWEPT_HERE: Record<string, string> = {
  '/': 'redirects to /login; asserted in the unauthenticated test',
  '/developers': 'section root; redirects to /developers/introduction, asserted in the developer portal test',
  '/inbox': 'covered by cypress/e2e/inbox/inbox.cy.ts',
  '/subscription': 'covered by cypress/e2e/settings/subscription-billing.cy.ts',
  '/onboarding': 'covered by cypress/e2e/auth/signup-and-onboarding.cy.ts',
  '/confirm': 'reached only from an emailed appointment-confirmation link',
  '/card-saved': 'Stripe redirect landing page, reached only after a real card setup',
  '/join': 'needs a live invite token; the invite flow is covered by rbac-roles.cy.ts',
  '/reset-password': 'needs a live password-recovery token from an email',
  '/legal/privacy': 'static legal copy, no app behaviour',
  '/legal/terms': 'static legal copy, no app behaviour',
  '/portal': 'patient portal -- separate app with its own auth, not the staff sidebar',
  '/portal/login': 'patient portal -- separate app with its own auth',
  '/portal/signup': 'patient portal -- separate app with its own auth',
  '/portal/not-found': 'patient portal -- separate app with its own auth',
}

describe('Every authenticated page renders for the account owner', () => {
  it('smoke-tests every static page plus dynamic patient/billing/role detail pages', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Smoke',
        lastName: 'Test',
      }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id }).then((invoice: any) => {
          cy.login(account.email, account.password)

          for (const path of STATIC_AUTHENTICATED_PAGES) {
            cy.visit(path)
            cy.location('pathname').should('eq', path)
            cy.location('search').should('not.eq', '?denied=1')
            cy.contains('a', 'Dashboard').should('be.visible')
          }

          cy.visit(`/patients/${patient.id}`)
          cy.location('pathname').should('eq', `/patients/${patient.id}`)
          cy.contains('Smoke Test').should('be.visible')

          cy.visit(`/billing/${invoice.id}`)
          cy.location('pathname').should('eq', `/billing/${invoice.id}`)

          const practitionerRole = account.roles.find((r) => r.name === 'Practitioner')!
          cy.visit(`/settings/roles/${practitionerRole.id}`)
          cy.location('pathname').should('eq', `/settings/roles/${practitionerRole.id}`)
          cy.contains('Role name').should('be.visible')
        })
      })
    })
  })

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

  // Visits nothing -- it just compares pages/ against the lists above, so a
  // page added without a decision about how it gets tested fails here
  // instead of shipping untested. Dynamic routes are excluded: the
  // authenticated sweep already visits the ones that matter with real
  // fixtures ([id] for patients/billing/roles), and the token-based ones
  // ([token], [slug]) can't be visited without a live token.
  it('has every page in pages/ either swept here or explicitly accounted for', () => {
    cy.task<string[]>('app:pageRoutes').then((routes) => {
      const accountedFor = new Set([...STATIC_AUTHENTICATED_PAGES, ...UNAUTHENTICATED_PAGES, ...Object.keys(NOT_SWEPT_HERE)])
      const unaccounted = routes.filter((route) => !route.includes('[') && !accountedFor.has(route))

      expect(
        unaccounted,
        'pages with no e2e coverage -- add them to STATIC_AUTHENTICATED_PAGES, or to NOT_SWEPT_HERE with the reason',
      ).to.deep.eq([])
    })
  })
})
