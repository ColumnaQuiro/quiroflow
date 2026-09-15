// What happens when a lead writes back.
//
// Inbound messages were attributed to a patient or to nobody, so a reply
// from somebody who enquired through a Facebook ad -- a lead, by definition
// not yet a patient -- attached to nothing. Their Inbox thread showed only
// what the clinic had sent them, with their answers missing, and the lead's
// drawer showed no sign they had ever written back. That is the one event
// the whole acquisition funnel exists to cause.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const APP_SECRET_LENGTH = 32

describe('A lead writes back', () => {
  let account: SeededAccount
  let phoneNumberId: string
  let appSecret: string
  let leadPhone: string

  function payload(from: string, text: string) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneNumberId },
                messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from, type: 'text', text: { body: text } }],
              },
            },
          ],
        },
      ],
    }
  }

  /** Signed over the exact bytes, the way Meta itself calls. */
  function deliver(from: string, text: string) {
    const body = JSON.stringify(payload(from, text))
    return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
      cy.request({
        method: 'POST',
        url: '/api/whatsapp/webhook',
        body,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
      }),
    )
  }

  beforeEach(() => {
    // Fresh per test: the webhook resolves the account by phone_number_id with
    // maybeSingle(), so two accounts sharing one id match two rows, resolve to
    // none, and the endpoint quietly does nothing.
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    leadPhone = `346${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
      cy.login(account.email, account.password)
    })
  })

  it('attaches the reply to the lead who sent it', () => {
    cy.task<{ id: string }>('db:createLead', {
      accountId: account.accountId,
      fullName: 'Wrote Back',
      phone: leadPhone,
      channel: 'facebook',
    }).then((lead) => {
      deliver(leadPhone, 'Hola, sí me interesa')

      cy.task('db:leadMessages', { leadId: lead.id }).then((rows) => {
        const messages = rows as { status: string }[]
        expect(messages, 'the reply is on the lead').to.have.length(1)
      })
    })
  })

  it('puts the reply on the lead timeline, with what they said', () => {
    cy.task<{ id: string }>('db:createLead', {
      accountId: account.accountId,
      fullName: 'Said Something',
      phone: leadPhone,
    }).then((lead) => {
      deliver(leadPhone, 'Me duele la espalda desde hace un mes')

      cy.task('db:leadEvents', { leadId: lead.id }).then((rows) => {
        const events = rows as { kind: string; title: string; detail: string | null }[]
        const replied = events.find((e) => e.title === 'Replied')
        expect(replied, 'a Replied event').to.not.be.undefined
        expect(replied!.kind).to.eq('conversation')
        expect(replied!.detail).to.contain('espalda')
      })
    })
  })

  it('asks for a person when the AI was the one handling it', () => {
    cy.task<{ id: string }>('db:createLead', {
      accountId: account.accountId,
      fullName: 'Ai Was Handling',
      phone: leadPhone,
      aiHandling: true,
    }).then((lead) => {
      deliver(leadPhone, '¿Cuánto cuesta?')

      cy.task('db:leadById', { id: lead.id }).then((row) => {
        // Nothing answers real enquiries yet, so a reply to the AI is a
        // reply nobody is reading until this says so.
        expect((row as { ai_state: string }).ai_state).to.eq('needs_human')
      })
    })
  })

  it('leaves a lead a person already took over where they put it', () => {
    cy.task<{ id: string }>('db:createLead', {
      accountId: account.accountId,
      fullName: 'Human Has It',
      phone: leadPhone,
    }).then((lead) => {
      cy.task('db:setLeadAiState', { id: lead.id, aiState: 'paused' })
      deliver(leadPhone, 'otra pregunta')

      cy.task('db:leadById', { id: lead.id }).then((row) => {
        expect((row as { ai_state: string }).ai_state).to.eq('paused')
      })
    })
  })

  it('gives the message to the patient when the number is one', () => {
    // Somebody who became a patient is a patient, and their messages belong
    // in the clinical thread rather than back on the lead card.
    cy.task<{ id: string }>('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Now A',
      lastName: 'Patient',
      phone: leadPhone.replace(/^34/, ''),
    })
    cy.task<{ id: string }>('db:createLead', {
      accountId: account.accountId,
      fullName: 'Old Lead Record',
      phone: leadPhone,
    }).then((lead) => {
      deliver(leadPhone, 'hola')

      cy.task('db:leadMessages', { leadId: lead.id }).then((rows) => {
        expect(rows as unknown[], 'nothing lands on the lead').to.have.length(0)
      })
    })
  })
})
