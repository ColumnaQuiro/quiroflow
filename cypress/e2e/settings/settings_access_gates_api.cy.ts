// Hiding a Settings page is not a guard.
//
// utils/routePermissions.ts has always gated Settings routes on two things --
// `can(settings_access) && can(billing_config)` and so on -- but the API
// behind them checked the sub-permission alone. A role with
// `settings_access: false` and `billing_config: true` therefore saw no
// Settings link, was bounced off /settings/payments, and could still POST
// /api/stripe/secrets and overwrite the clinic's live Stripe key.
//
// These drive the real endpoints with a real staff session, because that is
// the path that was open -- the UI assertions alone never caught it.

/** Signs in as a staff member on a role with `perm` but no settings_access. */
function staffWithoutSettings(perm: string, then: (auth: { email: string; password: string }) => void) {
  cy.seedStaffAccount().then((account) => {
    cy.task('db:setRolePermissions', {
      accountId: account.accountId,
      roleName: 'Front Desk',
      patch: { settings_access: false, [perm]: true },
    })

    const email = `nosettings-${perm}-${Date.now()}@example.test`
    const password = 'Test1234!'
    cy.task('db:createTeamMemberWithRole', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      roleName: 'Front Desk',
      email,
      password,
      fullName: 'No Settings',
    }).then(() => {
      cy.login(email, password)
      // cy.session() leaves the browser on a blank page; the request below
      // needs an origin that carries the auth cookie.
      cy.visit('/dashboard')
      then({ email, password })
    })
  })
}

describe('Settings-only endpoints require settings_access too', () => {
  it('refuses to write Stripe credentials without settings_access', () => {
    staffWithoutSettings('billing_config', () => {
      cy.request({
        method: 'POST',
        url: '/api/stripe/secrets',
        failOnStatusCode: false,
        body: { secretKey: 'sk_test_thisisnotarealkey000000000000' },
      }).then((res) => {
        expect(res.status, 'POST /api/stripe/secrets').to.eq(403)
        expect(res.body.statusMessage).to.contain('settings_access')
      })
    })
  })

  it('refuses to report which Stripe credentials are set', () => {
    staffWithoutSettings('billing_config', () => {
      cy.request({ url: '/api/stripe/secrets', failOnStatusCode: false }).then((res) => {
        expect(res.status, 'GET /api/stripe/secrets').to.eq(403)
      })
    })
  })

  it('refuses the WhatsApp app secret without settings_access', () => {
    staffWithoutSettings('communication_config', () => {
      cy.request({ url: '/api/whatsapp/app-secret', failOnStatusCode: false }).then((res) => {
        expect(res.status, 'GET /api/whatsapp/app-secret').to.eq(403)
      })
    })
  })

  it('refuses the data-admin endpoints without settings_access', () => {
    staffWithoutSettings('data_admin', () => {
      cy.request({ url: '/api/download/migrate-attachments-script', failOnStatusCode: false }).then((res) => {
        expect(res.status, 'GET /api/download/migrate-attachments-script').to.eq(403)
      })
    })
  })

  it('still lets the same role do its own job', () => {
    // The control, and the reason this fix is narrow. communication_config
    // also gates campaigns and the WhatsApp template picker used by the send
    // modals -- none of which is a Settings page, and all of which a
    // receptionist without settings_access is meant to use. If requiring
    // settings_access had been applied to every route behind these
    // permissions, this would 403.
    staffWithoutSettings('communication_config', () => {
      cy.request({ url: '/api/whatsapp/templates', failOnStatusCode: false }).then((res) => {
        expect(res.status, 'GET /api/whatsapp/templates').to.not.eq(403)
      })
    })
  })
})
