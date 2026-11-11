// WhatsApp Coexistence: the clinic's number is on the WhatsApp Business app
// on their phone AND connected to QuiroFlow, so the front desk can keep
// answering from the phone. Two webhooks exist only for that arrangement:
//
// - smb_message_echoes: what the clinic wrote from the phone. Stored as an
//   outbound message by a person, so the Inbox shows both halves and the
//   receptionist -- which drafts only when the patient wrote last, and holds a
//   reply back when "a person" wrote meanwhile -- stays out of it.
// - history: the phone's chats from before connecting, shared once. Imported
//   for people QuiroFlow knows, never acted on, and not dumped on the team as
//   a pile of unread conversations.

let phoneNumberId = ''
let appSecret = ''
let accountId = ''
let clinicId = ''
let phone = ''

const APP_SECRET_LENGTH = 32

const wamid = () => `wamid.${Date.now()}${Math.floor(Math.random() * 1e9)}`
const nowSeconds = () => String(Math.floor(Date.now() / 1000))

/** A change as Meta sends it: the number's id, plus whatever this field carries. */
function delivery(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-test', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
  }
}

/** Posts pre-serialised bytes, so the signature over them stays valid. */
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

function echo(id: string, to: string, text: string) {
  return delivery('smb_message_echoes', {
    message_echoes: [{ from: '34910000000', to, id, timestamp: nowSeconds(), type: 'text', text: { body: text } }],
  })
}

function messagesWith(id: string) {
  return cy.task<Record<string, unknown>[]>('db:selectRows', {
    table: 'whatsapp_messages',
    columns: 'wamid, direction, status, origin, sent_by_ai, patient_id, lead_id, body_preview, created_at',
    match: { wamid: id },
  })
}

describe('A number shared with the WhatsApp Business app', () => {
  beforeEach(() => {
    // Fresh per test, for the reason the other WhatsApp specs give: the
    // webhook finds the account by whatsapp_phone_number_id, which is unique.
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    appSecret = 'c'.repeat(APP_SECRET_LENGTH)
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      clinicId = account.clinicId
      cy.task('db:setWhatsappPhoneNumberId', { accountId, phoneNumberId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  describe('a message written from the phone', () => {
    it('lands in the patient’s thread as the clinic’s reply, by a person, once', () => {
      cy.task<{ id: string }>('db:createPatient', { accountId, clinicId, firstName: 'Marta', lastName: 'Móvil' }).then((patient) => {
        cy.task('db:insertRows', { table: 'patient_contact_numbers', rows: [{ account_id: accountId, patient_id: patient.id, country_code: 'ES', number: phone, is_whatsapp: true }] })
        const id = wamid()
        deliver(echo(id, `34${phone}`, 'Te esperamos el martes a las 10'))
        // Meta redelivers what it thinks we missed; the second copy is nothing.
        deliver(echo(id, `34${phone}`, 'Te esperamos el martes a las 10'))
        messagesWith(id).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]).to.include({
            direction: 'outbound',
            status: 'sent',
            origin: 'business_app',
            sent_by_ai: false,
            patient_id: patient.id,
            body_preview: 'Te esperamos el martes a las 10',
          })
        })
      })
    })

    it('takes a lead over from the receptionist, as writing to them in person does', () => {
      // On the phone there is no locked composer to click through: writing to
      // a lead the AI is handling IS taking it over. Left 'handling', the AI
      // would answer their next message in the middle of a person's chat.
      cy.task<{ id: string }>('db:createLead', { accountId, fullName: 'Lead Teléfono', phone: `+34${phone}`, aiHandling: true }).then((lead) => {
        cy.task('db:setLeadAiState', { id: lead.id, aiState: 'handling' })
        const id = wamid()
        deliver(echo(id, `34${phone}`, 'Hola, soy Ana de la clínica'))
        messagesWith(id).its(0).should('include', { lead_id: lead.id, direction: 'outbound', origin: 'business_app' })
        cy.task<{ ai_state: string }>('db:leadAiState', { id: lead.id }).its('ai_state').should('eq', 'paused')
        cy.task<{ title: string; detail: string | null }[]>('db:leadEvents', { leadId: lead.id }).then((events) => {
          expect(events.map((e) => e.title)).to.include('A person took over from the AI')
        })
      })
    })

    it('resolves a handover waiting for a person, as an Inbox reply does', () => {
      cy.task<{ id: string }>('db:createLead', { accountId, fullName: 'Lead Handover', phone: `+34${phone}` }).then((lead) => {
        cy.task('db:setLeadAiState', { id: lead.id, aiState: 'needs_human' })
        deliver(echo(wamid(), `34${phone}`, 'Te llamo ahora'))
        cy.task<{ ai_state: string }>('db:leadAiState', { id: lead.id }).its('ai_state').should('eq', 'none')
      })
    })

    it('does not invent a lead for a number nobody knows', () => {
      // The business phone also talks to suppliers and friends.
      const id = wamid()
      deliver(echo(id, `34${phone}`, 'Mañana paso a por el pedido'))
      messagesWith(id).its(0).should('include', { lead_id: null, patient_id: null, origin: 'business_app' })
      cy.task<unknown[]>('db:leadsByExternalId', { accountId, externalSource: 'whatsapp' }).should('have.length', 0)
    })
  })

  describe('the chat history shared on connecting', () => {
    it('imports a known patient’s conversation as history, read, and leaves strangers out', () => {
      cy.task<{ id: string }>('db:createPatient', { accountId, clinicId, firstName: 'Hugo', lastName: 'Historial' }).then((patient) => {
        cy.task('db:insertRows', { table: 'patient_contact_numbers', rows: [{ account_id: accountId, patient_id: patient.id, country_code: 'ES', number: phone, is_whatsapp: true }] })
        const asked = wamid()
        const answered = wamid()
        const strangers = wamid()
        const then = Math.floor(Date.now() / 1000) - 3 * 24 * 3600
        deliver(
          delivery('history', {
            history: [
              {
                metadata: { phase: 0, chunk_order: 1, progress: 100 },
                threads: [
                  {
                    id: `34${phone}`,
                    messages: [
                      { from: `34${phone}`, id: asked, timestamp: String(then), type: 'text', text: { body: '¿Tenéis hueco el jueves?' }, history_context: { status: 'READ' } },
                      { from: '34910000000', to: `34${phone}`, id: answered, timestamp: String(then + 60), type: 'text', text: { body: 'Sí, a las 17:00' }, history_context: { status: 'READ' } },
                    ],
                  },
                  {
                    id: '34699999999',
                    messages: [{ from: '34699999999', id: strangers, timestamp: String(then), type: 'text', text: { body: 'La factura del mes' } }],
                  },
                ],
              },
            ],
          }),
        )

        messagesWith(asked).its(0).should('include', { direction: 'inbound', status: 'received', origin: 'history', patient_id: patient.id })
        messagesWith(answered).then((rows) => {
          expect(rows[0]).to.include({ direction: 'outbound', status: 'read', origin: 'history', sent_by_ai: false, patient_id: patient.id })
          // When it was said, not when it was imported: the thread's order and
          // every "last 24 hours" read depend on it.
          expect(new Date(rows[0]!.created_at as string).getTime()).to.eq((then + 60) * 1000)
        })
        messagesWith(strangers).should('have.length', 0)

        // Read for the team up to the newest imported message, so connecting
        // does not light up every old conversation as unread.
        cy.task<{ last_read_at: string }[]>('db:selectRows', { table: 'inbox_reads', columns: 'last_read_at', match: { conversation_key: patient.id } }).then((reads) => {
          expect(reads.length).to.be.greaterThan(0)
          expect(new Date(reads[0]!.last_read_at).getTime()).to.eq((then + 60) * 1000)
        })
      })
    })

    it('takes the clinic declining to share their history as nothing to import', () => {
      deliver(delivery('history', { history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business from the WhatsApp Business App' }] }] })).its('status').should('eq', 200)
    })
  })
})
