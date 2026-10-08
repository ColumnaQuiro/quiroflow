// Facebook lead ads, received by QuiroFlow itself.
//
// Until October 2026 these reached us through an n8n workflow that listened
// for the Page's leadgen webhook and re-posted each lead to the public API.
// Now Meta tells /api/whatsapp/webhook directly, and we fetch the lead with
// the Page's own token. These drive the real webhook against the Graph stub
// (NUXT_META_GRAPH_BASE_URL), and hold the things the cutover depends on:
// a lead is filed once however many ways it arrives, it looks the way the
// n8n-relayed ones did, and nothing unverified gets in.
//
// Every name, number and answer here is invented.

const platformSecret = Cypress.env('META_PLATFORM_APP_SECRET') as string | undefined

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

/** Fresh per attempt: page_id is unique across accounts and nothing resets the database between retries. */
const freshId = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

function metaLead(id: string, formId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_time: '2026-10-08T07:12:30+0000',
    form_id: formId,
    ad_id: '120200000000000001',
    ad_name: 'Un día de consulta - Demo',
    adset_name: 'Valencia +8Km - Todos',
    campaign_name: 'Primera visita otoño',
    platform: 'fb',
    is_organic: false,
    field_data: [
      { name: 'first_name', values: ['Lucía'] },
      { name: 'last_name', values: ['Prueba'] },
      { name: 'email', values: ['lucia.prueba@example.com'] },
      { name: 'phone_number', values: ['+34612000111'] },
      { name: '¿cuál_sería_el_motivo_de_tu_visita?', values: ['Dolor lumbar al levantarme'] },
    ],
    custom_disclaimer_responses: [{ checkbox_key: 'marketing', is_checked: '1' }],
    ...extra,
  }
}

function leadgenBody(pageId: string, leadgenId: string, formId: string) {
  return JSON.stringify({
    object: 'page',
    entry: [{ id: pageId, time: 1759907550, changes: [{ field: 'leadgen', value: { leadgen_id: leadgenId, page_id: pageId, form_id: formId, ad_id: '120200000000000001', created_time: 1759907550 } }] }],
  })
}

function postSigned(body: string, secret: string, failOnStatusCode = true) {
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret: secret }).then((signed) =>
    cy.request({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
      failOnStatusCode,
    }),
  )
}

const facebookLeads = (accountId: string) => cy.task<any[]>('db:leadsByExternalId', { accountId, externalSource: 'facebook' })

describe('Facebook lead ads', () => {
  before(function () {
    // Skipped rather than failed when unset, the same as the platform
    // signature spec: without the secret there is nothing to sign with.
    if (!platformSecret) this.skip()
  })

  afterEach(() => cy.task('db:stopMetaGraphStub'))

  let account: SeededAccount
  let pageId: string
  let formId: string
  let leadgenId: string

  beforeEach(() => {
    pageId = freshId()
    formId = freshId()
    leadgenId = freshId()
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task('db:connectLeadAdPage', { accountId: account.accountId, pageId })
    })
  })

  describe('arriving by webhook', () => {
    it('files the lead the way the n8n relay did', () => {
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario primera visita', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId)],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), platformSecret!).its('status').should('eq', 200)

      facebookLeads(account.accountId).then((leads) => {
        expect(leads).to.have.length(1)
        const lead = leads[0]
        expect(lead.full_name).to.eq('Lucía Prueba')
        expect(lead.channel).to.eq('facebook')
        expect(lead.external_id, 'the leadgen id, which is what dedupes against the n8n relay').to.eq(leadgenId)
        // Bare E.164, as every other lead and WhatsApp's own webhook have it.
        expect(lead.phone).to.eq('34612000111')
        // The dashboard groups on the part before the dot.
        expect(lead.source).to.eq('Meta Ads · Valencia +8Km - Todos')
        expect(lead.marketing_consent_at, 'the form asked, and they ticked it').to.not.eq(null)

        cy.task<any>('db:leadById', { id: lead.id }).its('marketing_consent_source').should('eq', 'Meta lead form: Formulario primera visita')
        cy.task<any>('db:leadAttribution', { leadId: lead.id }).then((attr) => {
          expect(attr.campaign).to.eq('Primera visita otoño')
          expect(attr.audience).to.eq('Valencia +8Km - Todos')
          expect(attr.ad).to.eq('Un día de consulta - Demo')
          expect(attr.first_touch).to.eq('Facebook')
        })
        cy.task<any[]>('db:leadEvents', { leadId: lead.id }).then((events) => {
          const form = events.find((e) => e.kind === 'qualification')
          expect(form, 'the form answers are on the timeline').to.exist
          expect(form.body.answers).to.deep.eq([{ question: '¿cuál sería el motivo de tu visita?', answer: 'Dolor lumbar al levantarme' }])
        })
      })
      cy.task<any>('db:leadAdPage', { pageId }).its('page.last_lead_at').should('not.eq', null)
    })

    it('files a redelivered notification once', () => {
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId)],
      })
      const body = leadgenBody(pageId, leadgenId, formId)
      postSigned(body, platformSecret!)
      postSigned(body, platformSecret!)
      facebookLeads(account.accountId).should('have.length', 1)
    })

    // The cutover: n8n and the webhook both deliver the same submission for
    // as long as both are switched on. Same leadgen id, so one lead.
    it('does not file a lead the n8n relay already filed', () => {
      cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['leads:write'] }).then(({ token }) => {
        cy.request({
          method: 'POST',
          url: '/api/public/v1/leads',
          headers: { Authorization: `Bearer ${token}` },
          body: { first_name: 'Lucía', last_name: 'Prueba', phone: '34612000111', channel: 'facebook', external_id: leadgenId, external_source: 'facebook', marketing_consent: true },
        })
      })
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId)],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), platformSecret!).its('status').should('eq', 200)
      facebookLeads(account.accountId).should('have.length', 1)
    })

    it('still files the lead when the token cannot read the ad names', () => {
      cy.task('db:startMetaGraphStub', {
        refuseAdNames: true,
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId)],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), platformSecret!)
      facebookLeads(account.accountId).then((leads) => {
        expect(leads).to.have.length(1)
        expect(leads[0].full_name).to.eq('Lucía Prueba')
      })
    })

    it('takes consent from the checkbox when the form has one, whatever the Page says', () => {
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId, { custom_disclaimer_responses: [{ checkbox_key: 'marketing', is_checked: '' }] })],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), platformSecret!)
      facebookLeads(account.accountId).its('0.marketing_consent_at').should('eq', null)
    })

    it('leaves consent to the Page setting when the form asks nothing -- off by default', () => {
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId, { custom_disclaimer_responses: [] })],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), platformSecret!)
      facebookLeads(account.accountId).its('0.marketing_consent_at').should('eq', null)
    })

    it('counts submitting as consent when the clinic has said its form covers it', () => {
      const otherPage = freshId()
      cy.task('db:connectLeadAdPage', { accountId: account.accountId, pageId: otherPage, formSubmissionIsConsent: true })
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId: otherPage, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId, { custom_disclaimer_responses: [] })],
      })
      postSigned(leadgenBody(otherPage, leadgenId, formId), platformSecret!)
      facebookLeads(account.accountId).its('0.marketing_consent_at').should('not.eq', null)
    })

    it('refuses a notification signed with the wrong secret, and files nothing', () => {
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId, leadIds: [leadgenId] }],
        leads: [metaLead(leadgenId, formId)],
      })
      postSigned(leadgenBody(pageId, leadgenId, formId), 'not-the-platform-secret', false).its('status').should('eq', 401)
      facebookLeads(account.accountId).should('have.length', 0)
    })

    it('drops a notification for a Page nobody connected', () => {
      cy.task('db:startMetaGraphStub', { leads: [metaLead(leadgenId, formId)] })
      postSigned(leadgenBody(freshId(), leadgenId, formId), platformSecret!).its('status').should('eq', 200)
      facebookLeads(account.accountId).should('have.length', 0)
    })
  })

  describe('catching up', () => {
    beforeEach(() => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
    })

    it('fetches the leads the webhook missed, but nothing from before the Page was connected', () => {
      const before = freshId()
      const after = freshId()
      // Connected an hour ago; one lead from yesterday and one from just now.
      const connectedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const otherPage = freshId()
      cy.task('db:connectLeadAdPage', { accountId: account.accountId, pageId: otherPage, connectedAt })
      cy.task('db:startMetaGraphStub', {
        leadForms: [{ id: formId, name: 'Formulario', pageId: otherPage, leadIds: [after] }],
        // The stub does not apply Meta's time filter, so the old lead is left
        // off the form's list: what is asserted is the window we ask for.
        leads: [metaLead(after, formId), metaLead(before, formId, { created_time: '2026-10-01T09:00:00+0000' })],
      }).then(() => {
        cy.request('POST', `/api/meta/lead-pages/${otherPage}/sync`).its('body.filed').should('eq', 1)
        facebookLeads(account.accountId).then((leads) => {
          expect(leads.map((l) => l.external_id)).to.deep.eq([after])
        })
        // A second sweep straight away finds nothing new.
        cy.request('POST', `/api/meta/lead-pages/${otherPage}/sync`).its('body.filed').should('eq', 0)
        cy.task<any>('db:leadAdPage', { pageId: otherPage }).its('page.last_synced_at').should('not.eq', null)
      })
    })

    it('will not sweep another clinic’s Page', () => {
      cy.seedStaffAccount().then((other: any) => {
        const theirs = freshId()
        cy.task('db:connectLeadAdPage', { accountId: other.accountId, pageId: theirs })
        cy.request({ method: 'POST', url: `/api/meta/lead-pages/${theirs}/sync`, failOnStatusCode: false }).its('status').should('eq', 404)
      })
    })
  })

  describe('connecting and disconnecting', () => {
    beforeEach(() => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
    })

    it('connects every Page the clinic granted, and subscribes each to its leads', () => {
      const newPage = freshId()
      cy.task<{ seen: string[] }>('db:startMetaGraphStub', { pages: [{ id: newPage, name: 'Clínica Demo Valencia', access_token: 'STUB-PAGE-TOKEN-2' }] })
      cy.request('POST', '/api/meta/lead-pages/connect', { code: 'AQBxyz-not-a-real-code' }).then((res) => {
        expect(res.body.connected).to.deep.eq([{ id: newPage, name: 'Clínica Demo Valencia' }])
      })
      cy.task<any>('db:leadAdPage', { pageId: newPage }).then(({ page, token }) => {
        expect(page.account_id).to.eq(account.accountId)
        expect(page.form_submission_is_consent, 'consent is never assumed').to.eq(false)
        expect(token, 'the Page token, not the user token').to.eq('STUB-PAGE-TOKEN-2')
      })
    })

    it('refuses a Page another clinic already has', () => {
      cy.seedStaffAccount().then((other: any) => {
        const theirs = freshId()
        cy.task('db:connectLeadAdPage', { accountId: other.accountId, pageId: theirs })
        cy.task('db:startMetaGraphStub', { pages: [{ id: theirs, name: 'Otra clínica', access_token: 'STUB-PAGE-TOKEN-3' }] })
        cy.request({ method: 'POST', url: '/api/meta/lead-pages/connect', body: { code: 'AQBxyz' }, failOnStatusCode: false }).its('status').should('eq', 409)
        cy.task<any>('db:leadAdPage', { pageId: theirs }).its('page.account_id').should('eq', other.accountId)
      })
    })

    it('stores nothing for a Page whose subscription Meta refused', () => {
      const newPage = freshId()
      cy.task('db:startMetaGraphStub', { failAt: 'subscribe', pages: [{ id: newPage, name: 'Clínica Demo', access_token: 'T' }] })
      cy.request({ method: 'POST', url: '/api/meta/lead-pages/connect', body: { code: 'AQBxyz' }, failOnStatusCode: false }).its('status').should('eq', 502)
      cy.task<any>('db:leadAdPage', { pageId: newPage }).its('page').should('eq', null)
    })

    it('switches form-submission consent on and off', () => {
      cy.request('PATCH', `/api/meta/lead-pages/${pageId}`, { formSubmissionIsConsent: true })
      cy.task<any>('db:leadAdPage', { pageId }).its('page.form_submission_is_consent').should('eq', true)
      cy.request({ method: 'PATCH', url: `/api/meta/lead-pages/${pageId}`, body: { formSubmissionIsConsent: 'yes' }, failOnStatusCode: false }).its('status').should('eq', 400)
    })

    it('disconnects, forgetting the token with the Page', () => {
      cy.task('db:startMetaGraphStub', {})
      cy.request('DELETE', `/api/meta/lead-pages/${pageId}`)
      cy.task<any>('db:leadAdPage', { pageId }).then(({ page, token }) => {
        expect(page).to.eq(null)
        expect(token).to.eq(null)
      })
    })

    it('is a communication_config job', () => {
      cy.task('db:setRolePermissions', {
        accountId: account.accountId,
        roleName: 'Front Desk',
        patch: { settings_access: true, communication_config: false },
      })
      const email = `nocomms-${Date.now()}@example.test`
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
        cy.request({ method: 'DELETE', url: `/api/meta/lead-pages/${pageId}`, failOnStatusCode: false }).its('status').should('be.oneOf', [401, 403])
        cy.request({ method: 'POST', url: '/api/meta/lead-pages/connect', body: { code: 'x' }, failOnStatusCode: false }).its('status').should('be.oneOf', [401, 403])
      })
    })
  })

  it('shows the connected Page and its health in Settings › Leads', () => {
    cy.login(account.email, account.password)
    cy.visit('/settings/leads')
    cy.get('[data-cy="leads-settings"][data-ready="true"]')
    cy.get(`[data-cy="facebook-lead-page"][data-page-id="${pageId}"]`).should('contain', 'Clínica Demo').and('contain', 'No leads yet')
  })
})
