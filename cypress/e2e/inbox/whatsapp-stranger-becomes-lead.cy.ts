// A WhatsApp message from somebody the clinic has never heard of.
//
// It used to attach to nothing: no patient matched, no lead matched, and the
// row was stored with both ids null. The person who sent it was not on the
// leads board, not in the funnel, not in the dashboard's channel table and
// not visible to the receptionist, which drafts per lead. An identical
// sentence sent on Instagram had been a lead since instagram-dms.cy.ts.
//
// The cases below are the ones where getting it wrong is expensive: creating
// a second lead for somebody who already has one, and creating a lead for
// somebody who is actually a patient.

interface Lead {
  id: string
  full_name: string
  channel: string
  source: string
  stage: string
  phone: string | null
  external_id: string
  marketing_consent_at: string | null
}

// Fresh per test, for the reason the other WhatsApp specs document: the
// webhook resolves the account with .maybeSingle() on
// whatsapp_phone_number_id, so two accounts sharing one match two rows,
// resolve to none, and the endpoint quietly does nothing -- which reads as a
// passing test whenever the assertion is "nothing happened".
let phoneNumberId = ''
let appSecret = ''
let accountId = ''
let clinicId = ''

const APP_SECRET_LENGTH = 32

function payload(from: string, text: string, profileName: string | null) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              // Meta sends this beside the messages and it is the only name
              // we ever get for a stranger -- there is no profile endpoint
              // to ask afterwards, the way Instagram has one.
              ...(profileName === null ? {} : { contacts: [{ wa_id: from, profile: { name: profileName } }] }),
              messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  }
}

/** Posts pre-serialised bytes, so the signature over them stays valid. */
function deliver(from: string, text: string, profileName: string | null = 'Lucía Ferrer') {
  const body = JSON.stringify(payload(from, text, profileName))
  return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
    cy.request({
      method: 'POST',
      url: '/api/whatsapp/webhook',
      body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
    }),
  )
}

function whatsappLeads() {
  return cy.task<Lead[]>('db:leadsByExternalId', { accountId, externalSource: 'whatsapp' })
}

describe('A WhatsApp message from a stranger', () => {
  beforeEach(() => {
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      clinicId = account.clinicId
      phoneNumberId = `3879335${Date.now()}`.slice(0, 15)
      appSecret = 'a'.repeat(APP_SECRET_LENGTH)
      cy.task('db:setWhatsappPhoneNumberId', { accountId, phoneNumberId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  it('becomes a lead the rest of Growth can see', () => {
    deliver('34611222333', '¿Cuánto cuesta la primera visita?')

    whatsappLeads().should((leads) => {
      expect(leads).to.have.length(1)
      const lead = leads[0]!
      // The WhatsApp profile name, which is what the front desk will
      // recognise them by on the board.
      expect(lead.full_name).to.eq('Lucía Ferrer')
      expect(lead.channel).to.eq('whatsapp')
      // Spelled so the dashboard's channelOf() gives WhatsApp its own row
      // rather than folding it into another channel's.
      expect(lead.source).to.eq('WhatsApp')
      // 'contacted', not 'new': they wrote first, and 'new' means an enquiry
      // nobody has spoken to.
      expect(lead.stage).to.eq('contacted')
      expect(lead.external_id).to.eq('34611222333')
      // Digits with no "+", which is what toE164Loose returns and what every
      // lead the ad ingest has written already holds. A "+" here would read
      // as correct and quietly stop findLeadIdByPhone matching them again.
      expect(lead.phone).to.eq('34611222333')
    })
  })

  it('records no marketing consent, so no drip can fire at them', () => {
    // Somebody who writes in has asked a question, not agreed to be
    // marketed at. leadRecipient()'s gate reads the absence of this column
    // and sends nothing -- which is the difference between answering a
    // person and messaging them under LSSI-CE without a lawful basis.
    deliver('34611222444', 'Hola, ¿abrís los sábados?')

    whatsappLeads().should((leads) => {
      expect(leads).to.have.length(1)
      expect(leads[0]!.marketing_consent_at).to.eq(null)
    })
  })

  it('does not create a second lead when they message again', () => {
    deliver('34611222555', 'Primera pregunta')
    deliver('34611222555', 'Y otra cosa...')

    whatsappLeads().should((leads) => expect(leads).to.have.length(1))
  })

  it('creates no lead for somebody who is already a patient', () => {
    // A patient always wins: their clinical thread is where their messages
    // belong, and a duplicate of them on the leads board is worse than
    // useless -- it puts a real patient into an acquisition funnel.
    cy.task('db:createPatient', {
      accountId,
      clinicId,
      firstName: 'Marta',
      lastName: 'Gil',
      phone: '611222666',
      phoneCountryCode: 'ES',
    })

    deliver('34611222666', 'Quería cambiar mi cita')

    whatsappLeads().should((leads) => expect(leads).to.have.length(0))
  })

  it('names them by their number when WhatsApp sends no profile name', () => {
    // full_name is NOT NULL, and a blank row on the board is worse than a
    // placeholder somebody can rename. Suffixed so two unnamed senders do
    // not render as the same person.
    deliver('34611222777', 'Hola', null)

    whatsappLeads().should((leads) => {
      expect(leads).to.have.length(1)
      expect(leads[0]!.full_name).to.eq('WhatsApp 2777')
    })
  })
})
