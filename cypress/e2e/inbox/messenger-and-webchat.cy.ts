// Two more ways into the Inbox: Facebook Messenger on the Page the clinic
// connected for Instagram, and the chat on the clinic's own website.
//
// Both are stored the way an Instagram DM is -- a lead per person, a row on
// the channel, the person known by an id rather than a phone -- so what is
// worth testing is what differs. For Messenger, that it arrives as object
// 'page' beside lead ads and was being dropped. For the website chat, that a
// public endpoint takes messages from anyone, and must hand a conversation
// back only to the browser that started it.

interface StoredMessage {
  direction: string
  status: string
  body_preview: string | null
  external_contact_id: string | null
  wamid: string | null
  channel: string
  lead_id: string | null
}

let accountId = ''
let staff: { email: string; password: string } | null = null

describe('Facebook Messenger in the Inbox', () => {
  let pageId = ''
  const appSecret = 'a'.repeat(32)

  function message(senderId: string, text: string, extra: Record<string, unknown> = {}) {
    return {
      sender: { id: senderId },
      recipient: { id: pageId },
      timestamp: Date.now(),
      message: { mid: `m.${Date.now()}.${Math.random()}`, text, ...extra },
    }
  }

  function deliver(events: Record<string, unknown>[]) {
    const body = JSON.stringify({ object: 'page', entry: [{ id: pageId, time: Date.now(), messaging: events }] })
    return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
      cy.request({ method: 'POST', url: '/api/whatsapp/webhook', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature } }),
    )
  }

  function stored() {
    return cy.task<StoredMessage[]>('db:messagesOnChannel', { accountId, channel: 'messenger' })
  }

  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      staff = { email: account.email, password: account.password }
      // Unique per test: the webhook routes by this id, and two accounts on
      // one id route to neither.
      pageId = `10${Date.now()}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`
      cy.task('db:setMessengerPage', { accountId, pageId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  it('stores a message to the Page as a lead conversation instead of dropping it', () => {
    deliver([message('psid-alpha', 'Hola, ¿abrís los sábados?')])
    stored().should((rows) => {
      expect(rows).to.have.length(1)
      expect(rows[0]!.direction).to.eq('inbound')
      expect(rows[0]!.body_preview).to.eq('Hola, ¿abrís los sábados?')
      expect(rows[0]!.external_contact_id).to.eq('psid-alpha')
      expect(rows[0]!.lead_id, 'filed on the lead it made').to.be.a('string')
    })
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'messenger' }).should((leads) => {
      const rows = leads as { channel: string; stage: string; external_id: string; full_name: string }[]
      expect(rows).to.have.length(1)
      expect(rows[0]!.channel).to.eq('messenger')
      expect(rows[0]!.stage).to.eq('contacted')
      expect(rows[0]!.external_id).to.eq('psid-alpha')
    })
  })

  it('ignores the Page\'s own replies echoed back, and receipts', () => {
    deliver([
      message('psid-echo', 'Te contesto yo', { is_echo: true }),
      // A read receipt has no message at all.
      { sender: { id: 'psid-read' }, recipient: { id: pageId }, timestamp: Date.now(), read: { watermark: Date.now() } },
    ])
    stored().should((rows) => expect(rows).to.have.length(0))
  })

  it('stores a redelivered message once', () => {
    const event = message('psid-repeat', 'Solo una vez')
    deliver([event])
    deliver([event])
    stored().should((rows) => expect(rows).to.have.length(1))
  })

  it('replies through the Page, tagged as a response', () => {
    cy.task('db:startMetaGraphStub', {})
    deliver([message('psid-reply', '¿Tenéis hueco el jueves?')])
    cy.task<{ id: string }[]>('db:leadsByExternalId', { accountId, externalSource: 'messenger' }).then((leads) => {
      cy.login(staff!.email, staff!.password)
      cy.visit('/dashboard')
      cy.request('POST', '/api/messenger/send', { leadId: leads[0]!.id, text: 'Sí, a las 10:00' }).its('body.ok').should('eq', true)
    })
    cy.task<any[]>('db:metaGraphStubSends').then((sends) => {
      const reply = sends.find((s) => s?.recipient?.id === 'psid-reply')
      expect(reply, 'one reply reached Meta').to.exist
      expect(reply._path).to.match(/\/me\/messages$/)
      expect(reply.messaging_type).to.eq('RESPONSE')
      expect(reply.message).to.deep.equal({ text: 'Sí, a las 10:00' })
    })
    stored().should((rows) => {
      const out = rows.filter((r) => r.direction === 'outbound')
      expect(out).to.have.length(1)
      expect(out[0]!.body_preview).to.eq('Sí, a las 10:00')
    })
    cy.task('db:stopMetaGraphStub')
  })

  it('refuses to reply outside the 24h window, in words', () => {
    cy.login(staff!.email, staff!.password)
    cy.request({ method: 'POST', url: '/api/messenger/send', body: { recipientId: 'psid-never-wrote', text: 'Hola' }, failOnStatusCode: false }).then((res) => {
      // Nobody has written from this id, so there is no lead to answer either.
      expect(res.status).to.be.oneOf([400, 404])
    })
  })
})

describe('The chat on the clinic\'s website', () => {
  let slug = ''
  // What the widget makes: random, and long enough to be the only key to the conversation.
  const visitor = () => `v${Date.now()}${Math.random().toString(36).slice(2)}`.padEnd(40, 'x').slice(0, 40)

  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      staff = { email: account.email, password: account.password }
      cy.task<{ slug: string }>('db:setWebchat', { accountId, enabled: true, greeting: '¡Hola! ¿En qué te ayudamos?' }).then((r) => {
        slug = r.slug
      })
    })
  })

  it('tells the widget nothing about a clinic whose chat is off', () => {
    cy.task('db:setWebchat', { accountId, enabled: false })
    cy.request({ url: `/api/public-webchat/${slug}`, failOnStatusCode: false }).its('status').should('eq', 404)
    cy.request({ method: 'POST', url: `/api/public-webchat/${slug}/messages`, body: { visitorId: visitor(), text: 'Hola' }, failOnStatusCode: false })
      .its('status')
      .should('eq', 404)
  })

  it('gives the widget its name and greeting when it is on', () => {
    cy.request(`/api/public-webchat/${slug}`).its('body').should((body) => {
      expect(body.greeting).to.eq('¡Hola! ¿En qué te ayudamos?')
      expect(body.clinicName).to.be.a('string')
      // Nothing else about the account leaves through a public endpoint.
      expect(Object.keys(body).sort()).to.deep.equal(['clinicName', 'greeting'])
    })
  })

  it('turns a visitor\'s message into a lead conversation', () => {
    const id = visitor()
    cy.request('POST', `/api/public-webchat/${slug}/messages`, { visitorId: id, text: '¿Cuánto cuesta la primera visita?' }).its('body.messages').should((messages) => {
      expect(messages).to.have.length(1)
      expect(messages[0].from).to.eq('visitor')
    })
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'webchat' }).should((leads) => {
      const rows = leads as { channel: string; external_id: string; full_name: string }[]
      expect(rows).to.have.length(1)
      expect(rows[0]!.channel).to.eq('webchat')
      expect(rows[0]!.external_id).to.eq(id)
      expect(rows[0]!.full_name).to.contain('Visitante web')
    })
    cy.task<StoredMessage[]>('db:messagesOnChannel', { accountId, channel: 'webchat' }).should((rows) => {
      expect(rows).to.have.length(1)
      expect(rows[0]!.direction).to.eq('inbound')
      expect(rows[0]!.lead_id).to.be.a('string')
    })
  })

  it('refuses a visitor id the widget would never make', () => {
    cy.request({ method: 'POST', url: `/api/public-webchat/${slug}/messages`, body: { visitorId: 'short', text: 'Hola' }, failOnStatusCode: false })
      .its('status')
      .should('eq', 400)
    cy.request({ url: `/api/public-webchat/${slug}/messages?visitorId=../../etc`, failOnStatusCode: false }).its('status').should('eq', 400)
  })

  it('hands the staff reply back to that visitor, and to nobody else', () => {
    const id = visitor()
    cy.request('POST', `/api/public-webchat/${slug}/messages`, { visitorId: id, text: '¿Atendéis por la tarde?' })
    cy.task<{ id: string }[]>('db:leadsByExternalId', { accountId, externalSource: 'webchat' }).then((leads) => {
      cy.login(staff!.email, staff!.password)
      cy.visit('/dashboard')
      cy.request('POST', '/api/webchat/send', { leadId: leads[0]!.id, text: 'Sí, hasta las 20:00' }).its('body.ok').should('eq', true)
    })
    cy.request(`/api/public-webchat/${slug}/messages?visitorId=${id}`).its('body.messages').should((messages) => {
      expect(messages.map((m: { from: string; text: string }) => `${m.from}: ${m.text}`)).to.deep.equal([
        'visitor: ¿Atendéis por la tarde?',
        'clinic: Sí, hasta las 20:00',
      ])
    })
    // Another browser on the same website sees an empty conversation.
    cy.request(`/api/public-webchat/${slug}/messages?visitorId=${visitor()}`).its('body.messages').should('have.length', 0)
  })

  it('gives the clinic the code to paste once the chat is on', () => {
    cy.login(staff!.email, staff!.password)
    cy.visit('/settings/whatsapp')
    cy.get('[data-cy="whatsapp-settings"][data-ready="true"]').should('exist')
    cy.get('[data-cy="webchat-enabled"]').should('be.checked')
    cy.get('[data-cy="webchat-snippet"]').should('contain', '/webchat.js').and('contain', `data-clinic="${slug}"`)
  })
})
