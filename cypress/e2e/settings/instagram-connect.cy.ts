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

    it('rejects an empty code', () => {
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

    it('asks instead of guessing when more than one Instagram account was ticked', () => {
      cy.task('db:startMetaGraphStub', {
        pages: [
          { id: `1${Date.now()}`, name: 'Clínica Demo Valencia', access_token: 'T1', instagram_business_account: { id: freshId(), username: 'demovalencia' } },
          { id: `2${Date.now()}`, name: 'Clínica Demo Jerez', access_token: 'T2', instagram_business_account: { id: freshId(), username: 'demojerez' } },
        ],
      })
      connect().then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.message ?? res.body.statusMessage).to.contain('@demovalencia').and.contain('@demojerez')
      })
      cy.task<string[]>('db:metaGraphStubSubscriptions').should('deep.equal', [])
      cy.task<any>('db:instagramConnection', { accountId: account.accountId }).its('instagramUserId').should('eq', null)
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
