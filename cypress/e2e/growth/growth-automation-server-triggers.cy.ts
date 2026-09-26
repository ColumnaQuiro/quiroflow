// Automations fired by the server itself rather than by a click: a patient
// cancelling by WhatsApp reply, a Stripe membership payment, and a freed slot
// offered to the waitlist.
//
// A characterization spec (see growth-automation-fire): none of these paths
// had a test that said what the rule actually sends, which is exactly what
// has to stay the same while the engine underneath changes.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
}

interface WhatsAppRow {
  status: string
  template_name: string
  appointment_id: string | null
}

const APP_SECRET_LENGTH = 32

describe('Automations fired by the server', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
    })
  })

  describe('a cancellation by WhatsApp reply', () => {
    it('cancels the appointment and runs the appointment.cancelled rules for it', () => {
      const phoneNumberId = `pnid-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      const phone = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
      const appSecret = Array.from({ length: APP_SECRET_LENGTH }, () => Math.floor(Math.random() * 16).toString(16)).join('')

      cy.task<{ id: string }>('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'appointment.cancelled',
        dryRun: true,
        actions: [{ type: 'whatsapp_template', config: { template_name: 'cita_cancelada', template_language: 'es' } }],
      })
      cy.task<{ id: string }>('auto:patient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Carla', lastName: 'Cancela' }).then((patient) => {
        cy.task('db:setWhatsappAppSecret', { accountId: account.accountId, appSecret })
        cy.task<{ id: string }>('db:seedWhatsappReplyScenario', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          patientId: patient.id,
          phoneNumberId,
          phone,
          confirmationStatus: 'pending',
        }).then((appt) => {
          const body = JSON.stringify({
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: { phone_number_id: phoneNumberId },
                      messages: [{ id: `wamid.${Date.now()}`, from: `34${phone}`, type: 'button', button: { text: 'Cancelar' } }],
                    },
                  },
                ],
              },
            ],
          })
          cy.task<{ signature: string }>('db:signWhatsappBody', { body, appSecret }).then((signed) => {
            cy.request({
              method: 'POST',
              url: '/api/whatsapp/webhook',
              body,
              headers: { 'content-type': 'application/json', 'x-hub-signature-256': signed.signature },
            })
          })

          cy.task<{ status: string }>('auto:appointment', { id: appt.id }).its('status').should('eq', 'cancelled')
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: patient.id }).then((rows) => {
            // The seeded reminder the reply answers, then the rule's message.
            const sent = rows.filter((r) => r.template_name === 'cita_cancelada')
            expect(sent).to.have.length(1)
            expect(sent[0]!.status).to.eq('would_send')
            expect(sent[0]!.appointment_id).to.eq(appt.id)
          })
        })
      })
    })
  })

  describe('a membership payment from Stripe', () => {
    it('runs the membership.payment_processed rules for the member', () => {
      const webhookSecret = `whsec_cypress_${Date.now()}`
      const subscriptionId = `sub_cypress_${Date.now()}`
      cy.task('db:createAutomationRule', {
        accountId: account.accountId,
        triggerEvent: 'membership.payment_processed',
        dryRun: true,
        actions: [{ type: 'whatsapp_template', config: { template_name: 'cuota_cobrada', template_language: 'es' } }],
      })
      cy.task<{ id: string }>('auto:patient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Mario',
        lastName: 'Miembro',
        phone: `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      }).then((patient) => {
        cy.task('auto:membershipOnStripe', { accountId: account.accountId, patientId: patient.id, subscriptionId, webhookSecret })
        const body = JSON.stringify({
          id: `evt_${Date.now()}`,
          object: 'event',
          type: 'invoice.paid',
          data: {
            object: {
              id: `in_${Date.now()}`,
              object: 'invoice',
              subscription: subscriptionId,
              amount_paid: 4000,
              amount_due: 4000,
              period_start: Math.floor(Date.now() / 1000),
            },
          },
        })
        cy.task<{ header: string }>('auto:signStripe', { body, secret: webhookSecret }).then(({ header }) => {
          cy.request({
            method: 'POST',
            url: `/api/stripe/webhook/${account.accountId}`,
            body,
            headers: { 'content-type': 'application/json', 'stripe-signature': header },
          })
            .its('body')
            .should('deep.eq', { received: true })
        })
        cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: patient.id }).then((rows) => {
          expect(rows.map((r) => r.template_name)).to.deep.eq(['cuota_cobrada'])
          expect(rows[0]!.status).to.eq('would_send')
          expect(rows[0]!.appointment_id).to.be.null
        })
      })
    })
  })

  describe('a slot offered to the waitlist', () => {
    it('cannot hold a waitlist.slot_offered rule, although the editor offers the trigger', () => {
      // Pinned as it is: the trigger was dropped from the CHECK constraint by
      // mistake in 20260915035941, while waitlistOffer.ts still fires it. The
      // engine change puts it back, and flips this test.
      cy.task<{ id: string | null; error: string | null }>('auto:tryInsertRule', { accountId: account.accountId, triggerEvent: 'waitlist.slot_offered' }).then((res) => {
        expect(res.id).to.be.null
        expect(res.error).to.contain('automation_rules_trigger_event_check')
      })
    })
  })
})
