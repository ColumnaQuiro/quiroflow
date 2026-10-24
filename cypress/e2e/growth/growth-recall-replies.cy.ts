// A patient answers a recall on WhatsApp. The recall templates carry no
// opt-out sentence, so refusing has to work through the reply itself: "No,
// gracias" (a quick reply) or BAJA / STOP typed marks the patient "do not
// contact", tags them, ends every sequence they are in and leaves a note on
// their contact log. "No, gracias" does that only as the answer to a recall:
// said to the receptionist or the desk, it answers them. "Más adelante" parks them in Recalls for two months and
// ends the recall that asked -- and only that one.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const APP_SECRET_LENGTH = 32

describe('A patient answers a recall', () => {
  let account: SeededAccount
  let phoneNumberId: string
  let appSecret: string
  let phone: string

  function payload(message: Record<string, unknown>) {
    return {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: `wamid.${Date.now()}${Math.random()}`, from: phone, ...message }] } }] }],
    }
  }

  /** Signed over the exact bytes, the way Meta itself calls. */
  function deliver(message: Record<string, unknown>) {
    const body = JSON.stringify(payload(message))
    return cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) =>
      cy.request({
        method: 'POST',
        url: '/api/whatsapp/webhook',
        body,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
      }),
    )
  }
  const button = (text: string) => deliver({ type: 'button', button: { text, payload: text } })
  const text = (body: string) => deliver({ type: 'text', text: { body } })
  /** The recall a "No, gracias" answers, as the automation stores it. */
  const sentRecall = (patientId: string) =>
    cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId, direction: 'outbound', templateName: 'recall_x', purpose: 'recall', bodyPreview: '¿Te busco un hueco?', createdAt: new Date(Date.now() - 60 * 1000).toISOString() })

  /** A recall rule (its WhatsApp step flagged as one) and a plain reminder rule, each with this patient parked at a wait. */
  function parkIn(patientId: string) {
    const wait = { type: 'wait_until', config: { event: 'whatsapp.replied', timeout_minutes: 7 * 1440 }, met: [], timeout: [] }
    return cy
      .task<{ id: string }>('auto:createFlowRule', {
        accountId: account.accountId,
        triggerEvent: 'segment',
        name: 'recall',
        entryMode: 'one_at_a_time',
        segment: { filters: { last_visit_before_days: 90 }, schedule: { kind: 'once' } },
        steps: [{ type: 'whatsapp_template', config: { template_name: 'recall_x', template_language: 'es', purpose: 'recall', variables: [{ source: 'first_name' }] } }, wait],
      })
      .then((recall) =>
        cy
          .task<{ id: string }>('auto:createFlowRule', {
            accountId: account.accountId,
            triggerEvent: 'appointment.booked',
            name: 'reminder',
            steps: [{ type: 'whatsapp_template', config: { template_name: 'reminder_x', template_language: 'es', variables: [{ source: 'first_name' }] } }, wait],
          })
          .then((reminder) => {
            cy.task('auto:insertPatientRun', { accountId: account.accountId, ruleId: recall.id, patientId, currentActionPosition: 1, waitingFor: 'whatsapp.replied' })
            cy.task('auto:insertPatientRun', { accountId: account.accountId, ruleId: reminder.id, patientId, currentActionPosition: 1, waitingFor: 'whatsapp.replied' })
            return cy.wrap({ recall: recall.id, reminder: reminder.id })
          }),
      )
  }

  beforeEach(() => {
    phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    phone = `346${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as SeededAccount
      cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId })
    })
  })
  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
  })

  it('"No, gracias" marks them do-not-contact, tags them, ends every sequence and logs it', () => {
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Declina', lastName: 'Recall', phone: phone.replace(/^34/, '') }).then((p) => {
      parkIn(p.id).then((rules) => {
        sentRecall(p.id)
        button('No, gracias')

        cy.task<{ do_not_contact: boolean; tags: string[] }>('auto:patientRow', { patientId: p.id }).then((row) => {
          expect(row.do_not_contact, 'do not contact').to.eq(true)
          expect(row.tags).to.include('baja whatsapp')
        })
        cy.task<{ status: string; stopped_reason: string | null }[]>('auto:runsForRule', { ruleId: rules.recall }).then(([run]) => {
          expect(run!.status).to.eq('cancelled')
          expect(run!.stopped_reason).to.eq('declined')
        })
        // A decline is a decline for everything, not only recalls.
        cy.task<{ status: string }[]>('auto:runsForRule', { ruleId: rules.reminder }).then(([run]) => expect(run!.status).to.eq('cancelled'))
        cy.task<{ action: string; note: string | null }[]>('auto:contactLogFor', { patientId: p.id }).then((rows) => {
          const note = rows.find((r) => r.action === 'other')
          expect(note, 'a contact log note').to.not.be.undefined
          expect(note!.note).to.contain('No, gracias')
        })
      })
    })
  })

  it('"No, gracias" said to the receptionist answers her, and is not a decline', () => {
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Contesta', lastName: 'Alba', phone: phone.replace(/^34/, '') }).then((p) => {
      sentRecall(p.id)
      // Then the receptionist asked whether they would rather move the visit.
      cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: p.id, direction: 'outbound', bodyPreview: '¿Te vendría bien moverla a otro día?', sentByAi: true })
      text('No, gracias')
      cy.task<{ do_not_contact: boolean; tags: string[] }>('auto:patientRow', { patientId: p.id }).then((row) => {
        expect(row.do_not_contact, 'still contactable').to.eq(false)
        expect(row.tags ?? []).to.not.include('baja whatsapp')
      })
    })
  })

  it('BAJA typed by hand does the same; a sentence does nothing', () => {
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Escribe', lastName: 'Baja', phone: phone.replace(/^34/, '') }).then((p) => {
      text('No gracias, mejor el jueves por la tarde')
      cy.task<{ do_not_contact: boolean }>('auto:patientRow', { patientId: p.id }).then((row) => expect(row.do_not_contact, 'a sentence is for the desk').to.eq(false))
      text('baja')
      cy.task<{ do_not_contact: boolean; tags: string[] }>('auto:patientRow', { patientId: p.id }).then((row) => {
        expect(row.do_not_contact).to.eq(true)
        expect(row.tags).to.include('baja whatsapp')
      })
    })
  })

  it('"Más adelante" parks them for two months and ends the recall, not the reminder', () => {
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Luego', lastName: 'Recall', phone: phone.replace(/^34/, '') }).then((p) => {
      parkIn(p.id).then((rules) => {
        button('Más adelante')

        cy.task<{ do_not_contact: boolean; recall_snoozed_until: string | null }>('auto:patientRow', { patientId: p.id }).then((row) => {
          expect(row.do_not_contact, 'still contactable').to.eq(false)
          const days = (Date.parse(row.recall_snoozed_until!) - Date.now()) / 86_400_000
          expect(days, 'about 60 days out').to.be.within(58, 61)
        })
        cy.task<{ status: string; stopped_reason: string | null }[]>('auto:runsForRule', { ruleId: rules.recall }).then(([run]) => {
          expect(run!.status).to.eq('cancelled')
          expect(run!.stopped_reason).to.eq('snoozed')
        })
        // The reply itself still reaches the reminder's wait, which takes its "met" path and finishes: not cancelled.
        cy.task<{ status: string; stopped_reason: string | null }[]>('auto:runsForRule', { ruleId: rules.reminder }).then(([run]) => expect(run!.stopped_reason).to.not.eq('snoozed'))
      })
    })
  })
})
