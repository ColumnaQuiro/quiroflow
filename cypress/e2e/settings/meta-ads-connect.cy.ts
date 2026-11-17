// /api/meta/ads/connect finishes the Meta Ads Connect button in Settings >
// Leads: it trades a code for a token, finds the ad account the grant
// covers, and stores the account id and the read token. Growth then reads the
// month's spend with it.
//
// Driven against the Graph stub (NUXT_META_GRAPH_BASE_URL) because it writes a
// credential. Every name and id here is invented.

const platformSecret = Cypress.env('META_PLATFORM_APP_SECRET') as string | undefined

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const connect = (body: Record<string, unknown> = { code: 'AQBxyz-not-a-real-code' }) =>
  cy.request({ method: 'POST', url: '/api/meta/ads/connect', body, failOnStatusCode: false })

const connection = (accountId: string) =>
  cy.task<any[]>('db:selectRows', { table: 'accounts', columns: 'meta_ads_account_id', match: { id: accountId } }).then((rows) =>
    cy.task<string | null>('db:accountSecretOf', { accountId, name: 'meta_ads_access_token' }).then((token) => ({ adAccountId: rows[0]?.meta_ads_account_id ?? null, token })),
  )

describe('Connecting Meta Ads', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
    })
  })

  afterEach(() => cy.task('db:stopMetaGraphStub'))

  it('refuses a caller with no session', () => {
    cy.clearCookies()
    connect().its('status').should('be.oneOf', [401, 403])
  })

  it('rejects a call with neither a code nor a ticket', () => {
    connect({}).its('status').should('eq', 400)
  })

  describe('through the exchange', () => {
    before(function () {
      if (!platformSecret) this.skip()
    })

    it('stores the one ad account the grant covers, with its token, and shows it in Settings', () => {
      cy.task('db:startMetaGraphStub', {
        // A 60-day user token, which is what the Meta Ads login hands out:
        // the card has to say by when to renew it. ads_read applies to all
        // the person's accounts, so the grant names none and /me/adaccounts
        // is what lists them.
        granularScopes: [{ scope: 'ads_read', target_ids: [] }],
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 59 * 86400,
        adAccounts: [
          { id: 'act_1111', account_id: '1111', name: 'Clínica Demo Ads', currency: 'EUR', account_status: 1 },
          // A closed account is not a candidate, not an ambiguity.
          { id: 'act_2222', account_id: '2222', name: 'Cuenta antigua', currency: 'EUR', account_status: 101 },
        ],
      })
      connect().then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body).to.deep.include({ connected: true, adAccountId: '1111', name: 'Clínica Demo Ads' })
      })
      connection(account.accountId).should('deep.equal', { adAccountId: '1111', token: 'STUB-BUSINESS-TOKEN' })

      cy.visit('/settings/leads')
      cy.get('[data-cy="meta-ads-account"]').should('contain', 'Clínica Demo Ads').and('contain', 'EUR')
      cy.get('[data-cy="meta-ads-status"]').should('contain', 'Connected')
      cy.get('[data-cy="meta-ads-renew"]').should('contain', 'renewed by')

      cy.get('[data-cy="meta-ads-disconnect"]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.get('[data-cy="meta-ads-status"]').should('contain', 'Not connected')
      connection(account.accountId).should('deep.equal', { adAccountId: null, token: null })
    })

    it('asks which ad account when there are several, handing out no token, then connects the pick', () => {
      cy.task('db:startMetaGraphStub', {
        adAccounts: [
          { id: 'act_3333', account_id: '3333', name: 'Clínica Demo Valencia', currency: 'EUR' },
          { id: 'act_4444', account_id: '4444', name: 'Clínica Demo Jerez', currency: 'EUR' },
        ],
      })
      connect().then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body.connected).to.eq(false)
        expect(res.body.choose.map((c: any) => c.adAccountId)).to.deep.equal(['3333', '4444'])
        expect(JSON.stringify(res.body)).not.to.contain('STUB-BUSINESS-TOKEN')
        connection(account.accountId).its('adAccountId').should('eq', null)

        connect({ ticket: res.body.ticket, adAccountId: '9999' }).its('status').should('eq', 400)
        connect({ ticket: res.body.ticket, adAccountId: 'act_4444' }).its('body').should('deep.include', { connected: true, adAccountId: '4444' })
      })
      connection(account.accountId).should('deep.equal', { adAccountId: '4444', token: 'STUB-BUSINESS-TOKEN' })
    })

    it('finds the ad account from the grant itself, where /me/adaccounts is refused', () => {
      // A system-user token from business login is refused GET /me/adaccounts
      // without business_management -- the first real connection, 15 Nov
      // 2026. The grant's own ads_read scope names the account instead.
      cy.task('db:startMetaGraphStub', {
        failAt: 'adaccounts',
        granularScopes: [{ scope: 'ads_read', target_ids: ['5555'] }],
        adAccounts: [{ id: 'act_5555', account_id: '5555', name: 'Clínica Demo Ads', currency: 'EUR', account_status: 1 }],
      })
      connect().then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body).to.deep.include({ connected: true, adAccountId: '5555', name: 'Clínica Demo Ads', currency: 'EUR' })
      })
      connection(account.accountId).should('deep.equal', { adAccountId: '5555', token: 'STUB-BUSINESS-TOKEN' })
    })

    it('says why when neither the grant nor /me/adaccounts names an account', () => {
      cy.task('db:startMetaGraphStub', { failAt: 'adaccounts' })
      connect().then((res) => {
        expect(res.status).to.eq(502)
        expect(res.body.message ?? res.body.statusMessage).to.contain('Missing Permissions')
      })
      connection(account.accountId).should('deep.equal', { adAccountId: null, token: null })
    })

    it('exchanges a user-token code with the app root it was issued for, and no other', () => {
      // The Meta Ads login is a user-token configuration, whose code Meta
      // only exchanges with the redirect_uri the dialog opened with -- the
      // app's own root, sent as fallback_redirect_uri (16 Nov 2026).
      cy.location('origin').then((origin) => {
        const root = `${origin}/`
        cy.task('db:startMetaGraphStub', {
          requireRedirectUri: root,
          adAccounts: [{ id: 'act_6666', account_id: '6666', name: 'Clínica Demo Ads', currency: 'EUR', account_status: 1 }],
        })
        // Anywhere else is not sent on to Meta at all, so the exchange fails.
        connect({ code: 'AQBxyz-not-a-real-code', redirectUris: ['https://elsewhere.example/'] }).its('status').should('eq', 502)
        connection(account.accountId).its('adAccountId').should('eq', null)
        connect({ code: 'AQBxyz-not-a-real-code', redirectUris: [root] }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body).to.deep.include({ connected: true, adAccountId: '6666' })
        })
      })
    })

    it("exchanges with the SDK's own landing page when that is what the popup used", () => {
      // In a popup the SDK binds the code to its xd_arbiter page with a
      // per-login token, read by the browser as the popup opens. The app root
      // is sent second, as a fallback, and is not needed here.
      cy.location('origin').then((origin) => {
        const sdk = 'https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46#cb=f1a2b3&domain=app&relation=opener'
        cy.task('db:startMetaGraphStub', {
          requireRedirectUri: sdk,
          adAccounts: [{ id: 'act_7777', account_id: '7777', name: 'Clínica Demo Ads', currency: 'EUR', account_status: 1 }],
        })
        connect({ code: 'AQBxyz-not-a-real-code', redirectUris: [sdk, `${origin}/`] }).then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body).to.deep.include({ connected: true, adAccountId: '7777' })
        })
      })
    })

    it('stores nothing when the grant has no ad account on it', () => {
      cy.task('db:startMetaGraphStub', { adAccounts: [] })
      connect().its('status').should('eq', 400)
      connection(account.accountId).should('deep.equal', { adAccountId: null, token: null })
    })

    it('stores nothing when the code is refused', () => {
      cy.task('db:startMetaGraphStub', { failAt: 'exchange' })
      connect().its('status').should('eq', 502)
      connection(account.accountId).should('deep.equal', { adAccountId: null, token: null })
    })
  })
})
