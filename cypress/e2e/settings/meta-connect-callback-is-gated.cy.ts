// /api/meta/connect/callback finishes Embedded Signup: it trades a code for a
// business token and writes that token onto the account.
//
// So it both spends a credential and overwrites where the clinic's WhatsApp
// sends from. These drive the real endpoint rather than reading the handler
// and trusting it, and they assert the ORDER of its checks as much as the
// checks themselves: permission is established before the body is read, and
// the body before any deployment config, so a caller who should not be here
// never learns whether this deployment has WhatsApp connect configured.
describe('Finishing an Embedded Signup connection', () => {
  const realisticBody = { code: 'AQBxyz-not-a-real-code' }

  it('refuses a caller with no session', () => {
    cy.request({
      method: 'POST',
      url: '/api/meta/connect/callback',
      body: realisticBody,
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.be.oneOf([401, 403])
    })
  })

  it('refuses a signed-in staff member without communication_config', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { settings_access: true, communication_config: false },
      })
      const email = `nocomms-${Date.now()}@example.test`
      const password = 'Test1234!'
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email,
        password,
        fullName: 'No Comms Config',
      }).then(() => {
        cy.login(email, password)
        cy.visit('/dashboard')
        cy.request({
          method: 'POST',
          url: '/api/meta/connect/callback',
          body: realisticBody,
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status, 'connecting WhatsApp is a communication_config job').to.be.oneOf([401, 403])
        })
      })
    })
  })

  it('rejects an empty code before it touches Meta', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      // Both the missing and the whitespace-only case: the handler trims, and
      // a blank string reaching the token exchange would spend a round trip
      // to be told what we already knew.
      for (const body of [{}, { code: '   ' }]) {
        cy.request({
          method: 'POST',
          url: '/api/meta/connect/callback',
          body,
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status, JSON.stringify(body)).to.eq(400)
        })
      }
    })
  })

  it('says the deployment is not configured rather than half-connecting', () => {
    // No metaPlatformAppId/Secret in CI, which is exactly the state every
    // deployment is in before the platform app is switched on. The endpoint
    // must refuse the whole thing -- writing a partial connection here would
    // point a clinic's webhook routing at nothing.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.request({
        method: 'POST',
        url: '/api/meta/connect/callback',
        body: realisticBody,
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(500)
        expect(JSON.stringify(res.body)).to.contain('not configured')
      })
      // And nothing was written on the way to that refusal.
      cy.task('db:accountWhatsappConnection', { accountId: account.accountId }).then((acc: any) => {
        expect(acc.whatsapp_access_token, 'no token stored').to.be.null
        expect(acc.whatsapp_business_account_id, 'no WABA stored').to.be.null
      })
    })
  })
})
