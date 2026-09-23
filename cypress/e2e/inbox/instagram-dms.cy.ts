// Instagram DMs arriving on the shared Meta webhook.
//
// Same endpoint, same app secret and the same signature check as WhatsApp --
// one Meta app, two products -- so what is worth testing is the part that
// differs: a payload shaped entry[].messaging[] rather than
// entry[].changes[], a sender identified by IGSID rather than phone number,
// and the clinic's own messages echoed back.
//
// Nothing here talks to Instagram. Sending is one Graph call and is not
// reachable from CI; receiving is a POST we can make ourselves, which is
// where the parsing, the routing to an account and the threading live.

interface StoredMessage {
  direction: string
  status: string
  body_preview: string | null
  external_contact_id: string | null
  wamid: string | null
  channel: string
  lead_id: string | null
}

// Fresh per test for the reason the WhatsApp spec documents: the webhook
// finds the account with .maybeSingle() on the id, so two accounts sharing
// one resolve to none and the endpoint quietly does nothing -- which reads
// as a passing test when the assertion is "nothing happened".
let igUserId = ''
let appSecret = ''
let accountId = ''
let staff: { email: string; password: string } | null = null

const APP_SECRET_LENGTH = 32

function payload(events: Record<string, unknown>[]) {
  return {
    object: 'instagram',
    entry: [{ id: igUserId, messaging: events }],
  }
}

function message(senderId: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    sender: { id: senderId },
    recipient: { id: igUserId },
    timestamp: Date.now(),
    message: { mid: `ig.${Date.now()}.${Math.random()}`, text, ...extra },
  }
}

/** Posts pre-serialised bytes, so a signature over them stays valid. */
function post(body: string, headers: Record<string, string>, failOnStatusCode = true) {
  return cy.request({
    method: 'POST',
    url: '/api/whatsapp/webhook',
    body,
    headers: { 'content-type': 'application/json', ...headers },
    failOnStatusCode,
  })
}

function deliver(events: Record<string, unknown>[]) {
  const body = JSON.stringify(payload(events))
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) => {
    return post(body, { 'x-hub-signature-256': signed.signature })
  })
}

function stored() {
  return cy.task<StoredMessage[]>('db:messagesOnChannel', { accountId, channel: 'instagram' })
}

describe('Instagram DMs in the Inbox', () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      staff = { email: account.email, password: account.password }
      // Unique per test, and it has to be: the webhook finds the clinic by
      // this id with .maybeSingle(), so two accounts sharing it resolve to
      // neither and the DM is silently skipped. It used to be
      // `1784140${Date.now()}`.slice(0, 17) -- 20 characters cut to 17, which
      // dropped the milliseconds, so the id changed once a second while
      // these tests start well under a second apart. Consecutive tests
      // collided, failed, and passed on retry a second later: most of the
      // retries in CI. 17 digits still, the length of a real one.
      igUserId = `17${Date.now()}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`
      appSecret = 'a'.repeat(APP_SECRET_LENGTH)
      cy.task('db:setInstagramAccount', { accountId, instagramUserId: igUserId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  it('stores a DM against the person who sent it', () => {
    deliver([message('igsid-alpha', 'Hola, ¿hacéis primera visita?')])
    stored().should((rows) => {
      expect(rows).to.have.length(1)
      expect(rows[0]!.channel).to.eq('instagram')
      expect(rows[0]!.direction).to.eq('inbound')
      expect(rows[0]!.body_preview).to.eq('Hola, ¿hacéis primera visita?')
      // The IGSID, not a phone. Without it every Instagram conversation in
      // the clinic collapses into one thread, because the Inbox keys threads
      // on patient, then phone, then this.
      expect(rows[0]!.external_contact_id).to.eq('igsid-alpha')
    })
  })

  it('keeps two people apart', () => {
    // The actual reason external_contact_id exists. Before it, both of these
    // would key to 'unknown' and render as one conversation with itself.
    deliver([message('igsid-one', 'Soy la primera')])
    deliver([message('igsid-two', 'Soy la segunda')])
    stored().should((rows) => {
      expect(rows).to.have.length(2)
      expect(new Set(rows.map((r) => r.external_contact_id))).to.have.property('size', 2)
    })
  })

  it('ignores the clinic\'s own messages echoed back', () => {
    // Meta echoes what the business sends. Storing those would duplicate
    // every reply the Inbox already recorded, and file the clinic as the
    // person who wrote in.
    deliver([message('igsid-echo', 'Te contesto yo', { is_echo: true })])
    stored().should((rows) => expect(rows).to.have.length(0))
  })

  it('stores an attachment as something rather than nothing', () => {
    // A photo with no caption is still a message somebody sent. A thread that
    // skips it reads as if they said nothing.
    deliver([
      {
        sender: { id: 'igsid-photo' },
        recipient: { id: igUserId },
        message: { mid: `ig.${Date.now()}`, attachments: [{ type: 'image' }] },
      },
    ])
    stored().should((rows) => {
      expect(rows).to.have.length(1)
      expect(rows[0]!.body_preview).to.eq('(image)')
    })
  })

  it('stores a redelivered message once', () => {
    // Meta redelivers whenever we answer anything but 200, and we now answer
    // 401 on anything unverifiable -- so redelivery is normal traffic, not an
    // edge case.
    const event = message('igsid-repeat', 'Solo una vez')
    deliver([event])
    deliver([event])
    stored().should((rows) => expect(rows).to.have.length(1))
  })

  it('turns an enquiry into a lead, so the rest of Growth can see it', () => {
    // Without this the DM exists only in the Inbox: absent from the leads
    // board, uncounted in the funnel, missing from the dashboard's channel
    // table, and invisible to the receptionist -- which drafts per lead.
    deliver([message('igsid-enquirer', '¿Cuánto cuesta la primera visita?')])

    cy.task('db:leadsByExternalId', { accountId, externalSource: 'instagram' }).should((leads) => {
      const rows = leads as { full_name: string; channel: string; source: string; stage: string; external_id: string }[]
      expect(rows).to.have.length(1)
      expect(rows[0]!.external_id).to.eq('igsid-enquirer')
      expect(rows[0]!.channel).to.eq('instagram')
      // Spelled so the dashboard's channelOf() reads it as its own channel.
      expect(rows[0]!.source).to.eq('Instagram')
      // 'contacted', not 'new': they wrote first, and 'new' means an enquiry
      // nobody has spoken to.
      expect(rows[0]!.stage).to.eq('contacted')
    })
  })

  it('names unnamed senders apart, so the board is readable', () => {
    // Instagram will not always say who somebody is -- a token scoped wrong,
    // a permission not yet approved -- and the lead is created anyway,
    // because a placeholder beats no lead. But several of them rendered as
    // identical rows called "Instagram user" cannot be told apart at all,
    // which is the state a clinic actually sees while the cause is fixed.
    deliver([message('igsid-aaaa1111', 'Primera')])
    deliver([message('igsid-bbbb2222', 'Segunda')])
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'instagram' }).should((leads) => {
      const names = (leads as { full_name: string }[]).map((l) => l.full_name)
      expect(names).to.have.length(2)
      expect(new Set(names), 'two senders, two distinguishable rows').to.have.property('size', 2)
      expect(names[0]).to.contain('Instagram user')
    })
  })

  it('keeps one lead for somebody who messages again', () => {
    // Deduped on external_id, the same pair the Facebook lead-ad ingest uses.
    // Otherwise a regular is a new lead every week and the funnel counts them
    // all as separate enquiries.
    deliver([message('igsid-regular', 'Hola otra vez')])
    deliver([message('igsid-regular', 'Y otra pregunta')])
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'instagram' }).should((leads) => {
      expect(leads as unknown[]).to.have.length(1)
    })
  })

  it('attaches the message to the lead it just made', () => {
    // The point of creating it: the thread on the leads board has to be the
    // same conversation as the one in the Inbox, not a lead with no messages
    // sitting beside a message belonging to nobody.
    deliver([message('igsid-attached', 'Buenas')])
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'instagram' }).then((leads) => {
      const leadId = (leads as { id: string }[])[0]!.id
      stored().should((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.lead_id, 'the message carries the lead').to.eq(leadId)
      })
      cy.task('db:sequenceRuns', { leadId }).should((runs) => {
        // And deliberately NOT dripped at. They are mid-conversation; a
        // scripted welcome sequence is the wrong reply to a live question.
        expect(runs as unknown[]).to.have.length(0)
      })
    })
  })

  it('gives the enquiry to the receptionist when it is switched on', () => {
    // The clearest case there is for a drafted reply waiting: somebody has
    // just asked a question, in a channel where answering fast is the whole
    // advantage.
    cy.task('db:setReceptionistEnabled', { accountId, enabled: true })
    deliver([message('igsid-for-alba', '¿Tenéis hueco esta semana?')])
    cy.task('db:leadsByExternalId', { accountId, externalSource: 'instagram' }).then((leads) => {
      const leadId = (leads as { id: string }[])[0]!.id
      cy.task('db:leadAiState', { id: leadId }).should((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('handling')
      })
    })
  })

  it('refuses a DM it cannot verify, so Meta sends it again', () => {
    const body = JSON.stringify(payload([message('igsid-forged', 'No debería entrar')]))
    cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret: 'f'.repeat(APP_SECRET_LENGTH) }).then((signed) => {
      post(body, { 'x-hub-signature-256': signed.signature }, false).its('status').should('eq', 401)
    })
    stored().should((rows) => expect(rows).to.have.length(0))
  })

  it('ignores a DM addressed to an Instagram account that is not ours', () => {
    // A silent 200, not a refusal: an id we do not know is not ours to answer
    // for, and a 401 here would tell a forger which ids exist.
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'not-ours', messaging: [{ sender: { id: 'igsid-x' }, recipient: { id: 'not-ours' }, message: { mid: 'ig.x', text: 'hola' } }] }],
    })
    cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) => {
      post(body, { 'x-hub-signature-256': signed.signature }).its('status').should('eq', 200)
    })
    stored().should((rows) => expect(rows).to.have.length(0))
  })

  it('lets staff answer a DM that has just arrived', () => {
    // The composer used to be shut on every Instagram thread, whatever the
    // timing: the window was measured over inbound messages with channel
    // 'whatsapp', and an Instagram thread has none, so "more than 24h since
    // they last wrote" showed against a message seconds old.
    deliver([message('igsid-fresh', 'Hola')])
    cy.login(staff!.email, staff!.password)
    cy.visit('/inbox')
    // The LEAD conversation, which is where a DM from somebody with no
    // patient record actually appears -- becoming a lead is what puts it
    // there. The plain message thread exists too; this is the one a person
    // opens.
    cy.contains('Instagram user').click()
    cy.contains('More than 24h since').should('not.exist')

    // And the reply goes to Instagram's own route. Lead replies all posted to
    // whatsapp/inbox-send, which addresses by phone number -- an Instagram
    // lead has none, so every answer came back 400 and /api/instagram/send
    // shipped without a single caller.
    cy.intercept('POST', '/api/instagram/send', { statusCode: 200, body: { ok: true, messageId: 'ig.stub' } }).as('igSend')
    cy.get('textarea').last().type('Buenas, sí que hacemos')
    cy.contains('button', 'Send').click()
    cy.wait('@igSend').its('request.body').should((body: any) => {
      expect(body.leadId, 'addressed by the lead it was written in').to.be.a('string')
      expect(body.text).to.eq('Buenas, sí que hacemos')
    })
  })

  it('refuses to reply outside the 24h window, in words', () => {
    // Instagram's own error for this is a numeric code. Somebody who has just
    // typed a reply deserves to be told why it cannot go.
    //
    // Nobody has ever written from this IGSID, so the window was never open.
    // Sending is a staff route, hence the login -- without it this answers
    // 403 and would "pass" a test asserting only that it refused.
    cy.login(staff!.email, staff!.password)
    cy.request({
      method: 'POST',
      url: '/api/instagram/send',
      body: { recipientId: 'igsid-stale', text: 'Hola de nuevo' },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(400)
      expect(JSON.stringify(res.body)).to.contain('24 hours')
    })
  })
})
