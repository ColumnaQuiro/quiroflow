// Someone who taps an ad that opens WhatsApp writes before the ad's form
// reaches us -- half an hour before, on 27 Nov 2026. In that gap the lead
// was a plain WhatsApp lead, the receptionist read them as somebody who had
// just written in, and quoted the clinic's regular 70 € first visit to a
// person the ad had promised one for 50 €.
//
// Meta says which ad it was on that first message (messages[].referral), so
// the lead is recorded as the ad's from the start; the form, when it comes,
// still fills in the campaign.

let phoneNumberId = ''
let appSecret = ''
let accountId = ''
let phone = ''

const APP_SECRET_LENGTH = 32

const wamid = () => `wamid.${Date.now()}${Math.floor(Math.random() * 1e9)}`

function deliver(payload: unknown) {
  const body = JSON.stringify(payload)
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
    cy.request({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
    }),
  )
}

function message(text: string, referral?: Record<string, string>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ wa_id: `34${phone}`, profile: { name: 'Lucía' } }],
          messages: [{ id: wamid(), from: `34${phone}`, type: 'text', text: { body: text }, ...(referral ? { referral } : {}) }],
        },
      }],
    }],
  }
}

const AD_REFERRAL = {
  source_type: 'ad',
  source_id: '120200000000000001',
  source_url: 'https://fb.me/test',
  headline: '-30% En tu Primera Visita',
  body: 'Tú ya has terminado de trabajar.',
  ctwa_clid: 'clid-test',
}

type LeadRow = { id: string; source: string | null; external_source: string | null; channel: string | null; phone: string | null }

function leadsForPhone() {
  return cy
    .task<LeadRow[]>('db:selectRows', {
      table: 'leads',
      columns: 'id, source, external_source, channel, phone',
      match: { account_id: accountId },
    })
    .then((rows) => rows.filter((r) => String(r.phone ?? '').endsWith(phone)))
}

function attributionOf(leadId: string) {
  return cy.task<{ campaign: string | null; ad: string | null; first_touch: string | null }[]>('db:selectRows', {
    table: 'lead_attribution',
    columns: 'campaign, ad, first_touch',
    match: { lead_id: leadId },
  })
}

describe('A WhatsApp message sent from an ad', () => {
  beforeEach(() => {
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    appSecret = 'd'.repeat(APP_SECRET_LENGTH)
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      cy.task('db:setWhatsappPhoneNumberId', { accountId, phoneNumberId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  it('records the lead as the ad’s from its first message', () => {
    deliver(message('Hola, quiero información', AD_REFERRAL)).its('status').should('eq', 200)
    leadsForPhone().then((leads) => {
      expect(leads).to.have.length(1)
      expect(leads[0]).to.include({ channel: 'whatsapp', external_source: 'whatsapp', source: 'Meta Ads · WhatsApp' })
      attributionOf(leads[0]!.id).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({ ad: '-30% En tu Primera Visita', first_touch: 'WhatsApp' })
      })
    })
  })

  it('leaves a message that did not come from an ad as a plain WhatsApp lead', () => {
    deliver(message('Hola, quiero información')).its('status').should('eq', 200)
    leadsForPhone().then((leads) => {
      expect(leads).to.have.length(1)
      expect(leads[0]).to.include({ source: 'WhatsApp' })
      attributionOf(leads[0]!.id).should('have.length', 0)
    })
  })

  it('lets the ad’s form, arriving later, fill in the campaign on the same lead', () => {
    deliver(message('Hola, quiero información', AD_REFERRAL))
    leadsForPhone().should('have.length', 1)
    cy.task<{ token: string }>('db:createApiToken', { accountId, scopes: ['leads:write'] }).then(({ token }) => {
      cy.request({
        method: 'POST',
        url: '/api/public/v1/leads',
        headers: { Authorization: `Bearer ${token}` },
        body: {
          first_name: 'Lucía',
          last_name: 'Prueba',
          phone: `34${phone}`,
          channel: 'facebook',
          external_id: `leadgen-${Date.now()}`,
          external_source: 'facebook',
          attribution: { campaign: 'Campaña de prueba', ad: 'Anuncio de prueba' },
        },
      })
    })
    leadsForPhone().then((leads) => {
      expect(leads, 'the form joined the conversation rather than starting a second lead').to.have.length(1)
      attributionOf(leads[0]!.id).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.include({ campaign: 'Campaña de prueba', ad: 'Anuncio de prueba' })
      })
    })
  })
})
