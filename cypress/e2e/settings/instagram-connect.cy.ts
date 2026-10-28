// /api/meta/instagram/connect finishes the Instagram Connect button: it
// trades a code for a token, finds the Instagram account behind the Page the
// clinic ticked, subscribes that Page to its DMs, and stores the id and the
// Page token.
//
// It writes a credential and decides where an Instagram account's DMs go, so
// these drive the real endpoint against the Graph stub
// (NUXT_META_GRAPH_BASE_URL). The ones that matter most are the refusals:
// an id stored without the Page subscription behind it, or one taken from
// another clinic, looks connected in Settings while DMs go nowhere.
//
// Every name and id here is invented.

const platformSecret = Cypress.env('META_PLATFORM_APP_SECRET') as string | undefined

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

/** Fresh per attempt: instagram_user_id is unique across accounts and nothing resets the database between retries. */
const freshId = () => `1784${Date.now()}${Math.floor(Math.random() * 1e4)}`

const connect = (code = 'AQBxyz-not-a-real-code') =>
  cy.request({ method: 'POST', url: '/api/meta/instagram/connect', body: { code }, failOnStatusCode: false })

describe('Connecting Instagram', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
    })
  })

  afterEach(() => cy.task('db:stopMetaGraphStub'))

  describe('before Meta is called', () => {
    it('refuses a caller with no session', () => {
      cy.clearCookies()
      connect().its('status').should('be.oneOf', [401, 403])
    })

    it('is a communication_config job', () => {
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { settings_access: true, communication_config: false },
      })
      const email = `nocomms-ig-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Front Desk',
        email,
        password: 'Test1234!',
        fullName: 'Recepción Demo',
      }).then(() => {
        cy.login(email, 'Test1234!')
        cy.visit('/dashboard')
        connect().its('status').should('be.oneOf', [401, 403])
      })
    })

    it('rejects a call with neither a code nor a ticket', () => {
      for (const body of [{}, { code: '   ' }]) {
        cy.request({ method: 'POST', url: '/api/meta/instagram/connect', body, failOnStatusCode: false }).its('status').should('eq', 400)
      }
    })
  })

  describe('through the exchange', () => {
    before(function () {
      // Skipped rather than failed when unset, as the lead ads spec does:
      // without the platform secret the endpoint is not configured at all.
      if (!platformSecret) this.skip()
    })

    it('stores the Instagram account behind the Page, with the Page token, and subscribes the Page to DMs', () => {
      const igId = freshId()
      const pageId = `1${Date.now()}`
      cy.task('db:startMetaGraphStub', {
        pages: [
          // A Page with no Instagram account on it is not a candidate, not an ambiguity.
          { id: `2${Date.now()}`, name: 'Clínica Demo Eventos', access_token: 'STUB-PAGE-TOKEN-OTHER' },
          { id: pageId, name: 'Clínica Demo', access_token: 'STUB-PAGE-TOKEN-IG', instagram_business_account: { id: igId, username: 'clinicademo' } },
        ],
      })
      connect().then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body).to.deep.include({ instagramUserId: igId, username: 'clinicademo', pageName: 'Clínica Demo' })
      })
      cy.task<{ instagramUserId: string | null; token: string | null }>('db:instagramConnection', { accountId: account.accountId }).should('deep.equal', {
        instagramUserId: igId,
        token: 'STUB-PAGE-TOKEN-IG',
      })
      cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [`${pageId}:messages`])
    })

    it('refuses a connection with no Instagram account on it', () => {
      cy.task('db:startMetaGraphStub', { pages: [{ id: `1${Date.now()}`, name: 'Clínica Demo', access_token: 'T' }] })
      connect().then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.message ?? res.body.statusMessage).to.contain('Instagram professional account')
      })
      cy.task<any>('db:instagramConnection', { accountId: account.accountId }).its('instagramUserId').should('eq', null)
    })

    it('connects only the account the grant names, when the token sees more than one', () => {
      // Business login keeps every asset any earlier login granted, so a
      // clinic that connected lead ads first brings that Page along. The
      // instagram_* scopes say which account THIS grant was for.
      const wanted = freshId()
      const leadAdsPage = `2${Date.now()}`
      const pageId = `1${Date.now()}`
      cy.task('db:startMetaGraphStub', {
        pages: [
          { id: leadAdsPage, name: 'Clínica Demo Valencia', access_token: 'T-LEADS', instagram_business_account: { id: freshId(), username: 'demovalencia' } },
          { id: pageId, name: 'Clínica Demo Jerez', access_token: 'T-IG', instagram_business_account: { id: wanted, username: 'demojerez' } },
        ],
        granularScopes: [
          { scope: 'pages_show_list', target_ids: [leadAdsPage, pageId] },
          { scope: 'instagram_manage_messages', target_ids: [wanted] },
        ],
      })
      connect().then((res) => {
        expect(res.status).to.eq(200)
        expect(res.body).to.deep.include({ connected: true, instagramUserId: wanted, username: 'demojerez' })
      })
      cy.task<any>('db:instagramConnection', { accountId: account.accountId }).should('deep.equal', { instagramUserId: wanted, token: 'T-IG' })
      cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [`${pageId}:messages`])
    })

    describe('when the grant still reaches more than one account', () => {
      let valencia: string
      let jerez: string
      let jerezPage: string

      beforeEach(() => {
        valencia = freshId()
        jerez = freshId()
        jerezPage = `2${Date.now()}`
        cy.task('db:startMetaGraphStub', {
          pages: [
            { id: `1${Date.now()}`, name: 'Clínica Demo Valencia', access_token: 'T1', instagram_business_account: { id: valencia, username: 'demovalencia' } },
            { id: jerezPage, name: 'Clínica Demo Jerez', access_token: 'T2', instagram_business_account: { id: jerez, username: 'demojerez' } },
          ],
        })
      })

      it('asks which one, storing and subscribing nothing, and hands out no token', () => {
        connect().then((res) => {
          expect(res.status).to.eq(200)
          expect(res.body.connected).to.eq(false)
          expect(res.body.choose).to.deep.equal([
            { instagramUserId: valencia, username: 'demovalencia', pageName: 'Clínica Demo Valencia' },
            { instagramUserId: jerez, username: 'demojerez', pageName: 'Clínica Demo Jerez' },
          ])
          // The Page tokens travel only inside the encrypted ticket.
          expect(JSON.stringify(res.body)).not.to.contain('T1').and.not.to.contain('T2')
        })
        cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [])
        cy.task<any>('db:instagramConnection', { accountId: account.accountId }).its('instagramUserId').should('eq', null)
      })

      it('connects the one the clinic picks, with that Page and its token', () => {
        connect().then((res) => {
          cy.request('POST', '/api/meta/instagram/connect', { ticket: res.body.ticket, instagramUserId: jerez }).its('body').should('deep.include', {
            connected: true,
            instagramUserId: jerez,
            username: 'demojerez',
          })
        })
        cy.task<any>('db:instagramConnection', { accountId: account.accountId }).should('deep.equal', { instagramUserId: jerez, token: 'T2' })
        cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [`${jerezPage}:messages`])
      })

      it('only lets the clinic pick an account it was offered, with a ticket that is its own', () => {
        connect().then((res) => {
          const ticket = res.body.ticket as string
          cy.request({ method: 'POST', url: '/api/meta/instagram/connect', body: { ticket, instagramUserId: freshId() }, failOnStatusCode: false }).its('status').should('eq', 400)
          // Changing one character of the authentication tag breaks the seal.
          const [version, iv, tag, sealed] = ticket.split(':')
          const tampered = [version, iv, (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1), sealed].join(':')
          cy.request({ method: 'POST', url: '/api/meta/instagram/connect', body: { ticket: tampered, instagramUserId: jerez }, failOnStatusCode: false }).its('status').should('eq', 400)
          // Another clinic holding the same ticket gets nothing from it.
          cy.seedStaffAccount().then((other: any) => {
            cy.login(other.email, other.password)
            cy.visit('/dashboard')
            cy.request({ method: 'POST', url: '/api/meta/instagram/connect', body: { ticket, instagramUserId: jerez }, failOnStatusCode: false }).its('status').should('eq', 400)
            cy.task<any>('db:instagramConnection', { accountId: other.accountId }).its('instagramUserId').should('eq', null)
          })
        })
        cy.task<any>('db:instagramConnection', { accountId: account.accountId }).its('instagramUserId').should('eq', null)
        cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [])
      })
    })

    it('refuses an Instagram account another clinic already has, and leaves it with them', () => {
      const igId = freshId()
      cy.seedStaffAccount().then((other: any) => {
        cy.task('db:setInstagramAccount', { accountId: other.accountId, instagramUserId: igId })
        cy.task('db:startMetaGraphStub', { pages: [{ id: `1${Date.now()}`, name: 'Otra clínica', access_token: 'T', instagram_business_account: { id: igId } }] })
        connect().its('status').should('eq', 409)
        // Refused before the subscription, so the other clinic's Page is not touched either.
        cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [])
        cy.task<any>('db:instagramConnection', { accountId: other.accountId }).its('instagramUserId').should('eq', igId)
        cy.task<any>('db:instagramConnection', { accountId: account.accountId }).its('instagramUserId').should('eq', null)
      })
    })

    it('stores nothing when Meta refuses the Page subscription', () => {
      cy.task('db:startMetaGraphStub', {
        failAt: 'subscribe',
        pages: [{ id: `1${Date.now()}`, name: 'Clínica Demo', access_token: 'T', instagram_business_account: { id: freshId() } }],
      })
      connect().its('status').should('eq', 502)
      cy.task<any>('db:instagramConnection', { accountId: account.accountId }).should('deep.equal', { instagramUserId: null, token: null })
    })

    it('stores nothing when the code is refused', () => {
      cy.task('db:startMetaGraphStub', { failAt: 'exchange' })
      connect().its('status').should('eq', 502)
      cy.task<any>('db:instagramConnection', { accountId: account.accountId }).should('deep.equal', { instagramUserId: null, token: null })
    })
  })
})
