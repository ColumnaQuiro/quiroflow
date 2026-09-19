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

  // Everything above stops before Meta is ever called. These go through the
  // whole exchange against a local stub -- which is the only hermetic way to
  // exercise the one endpoint that writes a credential onto an account.
  //
  // This replaced a test asserting a 500 "not configured". That assertion
  // only ever passed because metaPlatformAppId was blank; the moment it was
  // filled in, the endpoint sailed past that check and made a REAL call to
  // graph.facebook.com from CI. The 500 becoming a 502 was the cosmetic half
  // of that; the live network call was the real problem.
  describe('going all the way through', () => {
    afterEach(() => cy.task('db:stopMetaGraphStub'))

    const connect = (failOnStatusCode = true) =>
      cy.request({ method: 'POST', url: '/api/meta/connect/callback', body: realisticBody, failOnStatusCode })

    const connection = (accountId: string) => cy.task('db:accountWhatsappConnection', { accountId })

    it('stores the WABA and phone number the token actually grants', () => {
      cy.seedStaffAccount().then((account) => {
        cy.task('db:startMetaGraphStub', { wabaId: '111222333444555', phoneNumberId: '999888777666555' })
        cy.login(account.email, account.password)
        cy.visit('/dashboard')

        connect().then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.wabaId).to.eq('111222333444555')
        })
        connection(account.accountId).then((acc: any) => {
          expect(acc.whatsapp_business_account_id, 'WABA from the token, not the browser').to.eq('111222333444555')
          expect(acc.whatsapp_phone_number_id).to.eq('999888777666555')
          expect(acc.whatsapp_access_token, 'the business token is what gets stored').to.eq('STUB-BUSINESS-TOKEN')
        })
      })
    })

    it('refuses a grant that carries no WhatsApp account', () => {
      cy.seedStaffAccount().then((account) => {
        // A real case: someone clicks through the dialog and grants nothing.
        cy.task('db:startMetaGraphStub', { scope: 'none' })
        cy.login(account.email, account.password)
        cy.visit('/dashboard')

        connect(false).its('status').should('eq', 400)
        connection(account.accountId).then((acc: any) => expect(acc.whatsapp_access_token).to.be.null)
      })
    })

    // The half-connection cases. A failure at any step must leave the account
    // exactly as it was -- a stored token with no subscription, or a WABA id
    // with no token, is worse than no connection at all, because Settings
    // would then show it as connected while nothing works.
    const steps = [
      ['the code is already spent', 'exchange'],
      ['the token cannot be inspected', 'debug'],
      ['the numbers cannot be listed', 'phones'],
      ['the webhook subscription is refused', 'subscribe'],
    ] as const

    steps.forEach(([what, failAt]) => {
      it(`writes nothing when ${what}`, () => {
        cy.seedStaffAccount().then((account) => {
          cy.task('db:startMetaGraphStub', { failAt })
          cy.login(account.email, account.password)
          cy.visit('/dashboard')

          connect(false).its('status').should('be.oneOf', [400, 502])
          connection(account.accountId).then((acc: any) => {
            expect(acc.whatsapp_access_token, `no token after ${failAt} failed`).to.be.null
            expect(acc.whatsapp_business_account_id, `no WABA after ${failAt} failed`).to.be.null
          })
        })
      })
    })
  })
})
