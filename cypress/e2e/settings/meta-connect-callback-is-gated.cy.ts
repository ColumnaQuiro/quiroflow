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

    // Fresh per attempt, and that is not cosmetic. accounts_whatsapp_phone_number_id_key
    // makes a phone number id claimable exactly once, retries: { runMode: 2 }
    // gives every spec three attempts, and nothing resets the database between
    // them. A hard-coded id would therefore be claimed by attempt 1's
    // abandoned account, and attempt 2 would get the 409 this file tests --
    // turning any flake here into a permanent failure that reads as a real
    // bug. The same trap the comment at the top of
    // cypress/e2e/inbox/whatsapp-reply-intent.cy.ts describes.
    const freshPhoneNumberId = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

    it('stores the WABA and phone number the token actually grants', () => {
      const phoneNumberId = freshPhoneNumberId()
      cy.seedStaffAccount().then((account) => {
        cy.task('db:startMetaGraphStub', { wabaId: '111222333444555', phoneNumberId })
        cy.login(account.email, account.password)
        cy.visit('/dashboard')

        connect().then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.wabaId).to.eq('111222333444555')
        })
        connection(account.accountId).then((acc: any) => {
          expect(acc.whatsapp_business_account_id, 'WABA from the token, not the browser').to.eq('111222333444555')
          expect(acc.whatsapp_phone_number_id).to.eq(phoneNumberId)
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

    // The collision that made all of this worth fixing. Two clinics on one
    // phone number id does not misroute inbound WhatsApp -- the webhook looks
    // the account up with a single-row read, two rows resolve to none, and the
    // delivery is dropped for BOTH of them while each Settings page still
    // reads as connected. There is no symptom, which is why the second connect
    // has to be refused at the door.
    //
    // Driven through the real endpoint twice rather than by seeding the clash
    // directly: reaching it through the Connect button is precisely what
    // became possible when QuiroFlow started acting as a Tech Provider, and
    // seeding the second row would test the index instead of the handler.
    it('refuses a number another account already holds, and leaves both accounts alone', () => {
      const shared = freshPhoneNumberId()
      cy.task('db:startMetaGraphStub', { wabaId: '111222333444555', phoneNumberId: shared })

      cy.seedStaffAccount().then((first) => {
        cy.login(first.email, first.password)
        cy.visit('/dashboard')
        connect().its('status').should('eq', 200)

        cy.seedStaffAccount().then((second) => {
          cy.login(second.email, second.password)
          cy.visit('/dashboard')

          connect(false).then((res) => {
            expect(res.status, 'the number is taken').to.eq(409)
            expect(JSON.stringify(res.body), 'says what to do about it').to.match(/already connected/i)
          })

          // Nothing half-written on the clinic that lost the race: a stored
          // token with no working number is worse than no connection, because
          // Settings would then show it as connected.
          connection(second.accountId).then((acc: any) => {
            expect(acc.whatsapp_phone_number_id, 'the loser claims nothing').to.be.null
            expect(acc.whatsapp_access_token).to.be.null
            expect(acc.whatsapp_business_account_id).to.be.null
          })
          // And the clinic that already had it keeps working.
          connection(first.accountId).then((acc: any) => {
            expect(acc.whatsapp_phone_number_id, 'the holder is untouched').to.eq(shared)
            expect(acc.whatsapp_access_token).to.eq('STUB-BUSINESS-TOKEN')
          })
        })
      })
    })

    // Reconnecting your OWN number is not a collision -- a clinic re-running
    // Embedded Signup to refresh an expired token lands on the same id it
    // already has, and a check written as "does any account hold this" rather
    // than "does any OTHER account hold this" would lock it out of its own
    // connection with a 409 it could do nothing about.
    it('lets an account reconnect the number it already holds', () => {
      const phoneNumberId = freshPhoneNumberId()
      cy.task('db:startMetaGraphStub', { wabaId: '111222333444555', phoneNumberId })
      cy.seedStaffAccount().then((account) => {
        cy.login(account.email, account.password)
        cy.visit('/dashboard')

        connect().its('status').should('eq', 200)
        connect().its('status').should('eq', 200)
        connection(account.accountId).then((acc: any) => {
          expect(acc.whatsapp_phone_number_id).to.eq(phoneNumberId)
        })
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
