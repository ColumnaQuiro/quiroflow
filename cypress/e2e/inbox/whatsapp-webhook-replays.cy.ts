// Meta delivers the same webhook more than once, and says so: any answer but
// 200, a timeout, or nothing at all on their side, and it sends the delivery
// again -- for up to seven days. Status callbacks also arrive in whatever
// order their own pipeline produces them.
//
// Both used to do damage. A redelivered message failed its insert on the
// unique wamid, the error was never read, and everything after the insert ran
// a second time: the lead's "Replied" event, the push, the automations -- and
// the reply classification, which for a repeated "Cancelar" found the first
// appointment already cancelled and cancelled the patient's NEXT one instead.
// A late "delivered" overwrote "read", and a late "sent" wiped a failure's
// error so the thread showed a message as sent that never arrived.

let phoneNumberId = ''
let appSecret = ''
let phone = ''

const APP_SECRET_LENGTH = 32

const inDays = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString()

function signedPost(payload: unknown) {
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

function messagePayload(wamid: string, from: string, text: string, kind: 'text' | 'button' = 'text') {
  const message = kind === 'button' ? { type: 'button', button: { text } } : { type: 'text', text: { body: text } }
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: wamid, from, ...message }] } }] }],
  }
}

function statusPayload(wamid: string, status: string, errors?: unknown[]) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: wamid, status, ...(errors ? { errors } : {}) }] } }] }],
  }
}

function freshIds() {
  phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function messageByWamid(wamid: string) {
  return cy
    .task<{ status: string; error_code: string | null; error_message: string | null }[]>('db:selectRows', {
      table: 'whatsapp_messages',
      columns: 'status, error_code, error_message',
      match: { wamid },
    })
    .then((rows) => rows[0]!)
}

describe('A WhatsApp message Meta delivers twice', () => {
  beforeEach(freshIds)

  it('cancels one appointment, not the next one as well', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Twice' }).then((patient) => {
        cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
        cy.task<{ id: string }>('db:seedWhatsappReplyScenario', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          phoneNumberId,
          phone,
        }).then((reminded) => {
          // The visit after the one the reminder was about -- what the
          // replay used to find once the first was already cancelled.
          cy.task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: patient.id,
            startsAt: inDays(8),
          }).then((next) => {
            const payload = messagePayload(`wamid.cancel.${Date.now()}`, `34${phone}`, 'Cancelar', 'button')
            signedPost(payload)
            cy.task('db:appointmentById', { appointmentId: reminded.id }).its('status').should('eq', 'cancelled')

            // The same delivery, byte for byte, as Meta's retry sends it.
            signedPost(payload)
            cy.task('db:inboundMessages', { patientId: patient.id }).should('have.length', 1)
            cy.task('db:appointmentById', { appointmentId: next.id }).its('status').should('eq', 'booked')
          })
        })
      })
    })
  })

  it("records a lead's reply once", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
      cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
      const from = `34${phone}`
      const payload = messagePayload(`wamid.lead.${Date.now()}`, from, '¿Tenéis hueco el jueves?')
      signedPost(payload)
      signedPost(payload)

      cy.task<{ id: string }[]>('db:leadsByExternalId', { accountId: account.accountId, externalSource: 'whatsapp' }).then((leads) => {
        expect(leads).to.have.length(1)
        cy.task<{ title: string }[]>('db:leadEvents', { leadId: leads[0]!.id }).then((events) => {
          expect(events.filter((e) => e.title === 'Replied')).to.have.length(1)
        })
      })
      cy.task('db:messagesFromNumber', { accountId: account.accountId, phoneNumber: from }).should('have.length', 1)
    })
  })
})

describe('WhatsApp delivery statuses arriving out of order', () => {
  let accountId = ''

  beforeEach(() => {
    freshIds()
    cy.seedStaffAccount().then((account) => {
      accountId = account.accountId
      cy.task('db:setWhatsappPhoneNumberId', { accountId, phoneNumberId })
      cy.task('db:setWhatsappAppSecret', { accountId, appSecret })
    })
  })

  function outbound(wamid: string) {
    return cy.task('db:createWhatsappMessage', { accountId, phoneNumber: `34${phone}`, direction: 'outbound', status: 'sent', wamid })
  }

  it('still moves forward: sent, delivered, read', () => {
    const wamid = `wamid.fwd.${Date.now()}`
    outbound(wamid)
    signedPost(statusPayload(wamid, 'delivered'))
    messageByWamid(wamid).its('status').should('eq', 'delivered')
    signedPost(statusPayload(wamid, 'read'))
    messageByWamid(wamid).its('status').should('eq', 'read')
  })

  it('does not let a late "delivered" take back a "read"', () => {
    const wamid = `wamid.late.${Date.now()}`
    outbound(wamid)
    signedPost(statusPayload(wamid, 'read'))
    messageByWamid(wamid).its('status').should('eq', 'read')
    signedPost(statusPayload(wamid, 'delivered'))
    signedPost(statusPayload(wamid, 'sent'))
    messageByWamid(wamid).its('status').should('eq', 'read')
  })

  it('keeps a failure, and the reason for it, when a late "sent" arrives', () => {
    const wamid = `wamid.fail.${Date.now()}`
    outbound(wamid)
    signedPost(statusPayload(wamid, 'failed', [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Receiver is not on WhatsApp' } }]))
    messageByWamid(wamid).should((m) => {
      expect(m.status).to.eq('failed')
      expect(m.error_code).to.eq('131026')
    })
    signedPost(statusPayload(wamid, 'sent'))
    signedPost(statusPayload(wamid, 'delivered'))
    messageByWamid(wamid).should((m) => {
      expect(m.status).to.eq('failed')
      expect(m.error_code).to.eq('131026')
      expect(m.error_message).to.contain('Receiver is not on WhatsApp')
    })
  })
})
