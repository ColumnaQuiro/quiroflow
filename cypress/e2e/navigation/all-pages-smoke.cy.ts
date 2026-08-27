const STATIC_AUTHENTICATED_PAGES = [
  '/dashboard',
  '/calendar',
  '/patients',
  '/recalls',
  '/billing',
  '/billing/new',
  '/billing/services',
  '/reports',
  '/reports/appointment-distribution',
  '/reports/custom',
  '/reports/data-exports',
  '/reports/debtors',
  '/reports/income-performance',
  '/reports/income',
  '/reports/memberships',
  '/reports/scheduled-reminders',
  '/reports/statistics',
  '/reports/upcoming-visits',
  '/settings',
  '/settings/appointment-types',
  '/settings/clinics',
  '/settings/docs',
  '/settings/import',
  '/settings/memberships',
  '/settings/migrate-attachments',
  '/settings/packages',
  '/settings/payments',
  '/settings/practitioners',
  '/settings/roles',
  '/settings/rooms',
  '/settings/team',
  '/settings/webhooks',
  '/settings/whatsapp',
]

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

  it('smoke-tests the unauthenticated pages', () => {
    cy.clearCookies()

    // '/' deliberately redirects straight to '/login' (pages/index.vue) --
    // it has no standalone content for a logged-out visitor.
    cy.visit('/')
    cy.location('pathname').should('eq', '/login')

    for (const path of ['/login', '/signup', '/forgot-password']) {
      cy.visit(path)
      cy.location('pathname').should('eq', path)
    }
  })
})
