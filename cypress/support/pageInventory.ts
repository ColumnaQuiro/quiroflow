import { DEV_PORTAL_SLUGS } from '../../utils/devPortal'

// The single inventory of what the page sweeps cover, shared by every smoke
// spec. It lives here rather than in one spec because the sweep is split
// across several files -- one spec per slice, so no single spec sets the
// floor on how far CI can shard -- while the coverage guard in
// public-pages-smoke.cy.ts still has to see ALL of it at once. Splitting the
// lists along with the specs would have let a page fall between two of them
// with nothing noticing, which is the exact failure the guard exists to
// prevent.

// Everything under /settings, kept apart from the rest only so the two
// authenticated sweeps are roughly equal in runtime. Nothing behaves
// differently about them.
export const SETTINGS_PAGES = [
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

export const APP_PAGES = [
  '/account',
  '/dashboard',
  '/calendar',
  '/campaigns',
  '/care-plan-alerts',
  // The sweep sees the locked/upgrade state, which is what an account
  // without the tier gets. Both states are asserted in growth/growth-dashboard.cy.ts.
  '/growth',
  '/growth/leads',
  '/growth/receptionist',
  '/growth/automations',
  '/growth/reputation',
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
]

export const STATIC_AUTHENTICATED_PAGES = [...APP_PAGES, ...SETTINGS_PAGES]

// The developer portal (pages/developers/*) is public documentation, so it
// sweeps unauthenticated. Derived from the same list that builds the portal's
// sidebar and its prefix-free alias routes, so a page added there is covered
// automatically rather than tripping the guard test.
export const DEV_PORTAL_PAGES = DEV_PORTAL_SLUGS.map((slug) => `/developers/${slug}`)

export const UNAUTHENTICATED_PAGES = ['/login', '/signup', '/forgot-password', ...DEV_PORTAL_PAGES]

// Routes no sweep visits, each for a reason the guard test re-checks.
// Anything not here and not in one of the lists above makes that test fail,
// so a newly added page can't quietly go uncovered the way 17 of them
// already had.
export const NOT_SWEPT_HERE: Record<string, string> = {
  '/': 'redirects to /login; asserted in the unauthenticated test',
  '/developers': 'section root; redirects to /developers/introduction, asserted in the developer portal test',
  '/inbox': 'covered by cypress/e2e/inbox/inbox.cy.ts',
  '/subscription': 'covered by cypress/e2e/subscription/billing.cy.ts',
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
  '/portal/appointments': 'patient portal -- separate app with its own auth',
  '/portal/billing': 'patient portal -- separate app with its own auth',
  '/portal/documents': 'patient portal -- separate app with its own auth',
  '/portal/messages': 'patient portal -- separate app with its own auth',
}

// Every authenticated sweep asserts the same three things per page: it landed
// where it was asked, the permission guard didn't bounce it, and the shell
// rendered.
export function sweepAuthenticatedPages(paths: string[]) {
  for (const path of paths) {
    cy.visit(path)
    cy.location('pathname').should('eq', path)
    cy.location('search').should('not.eq', '?denied=1')
    cy.contains('a', 'Dashboard').should('be.visible')
  }
}
