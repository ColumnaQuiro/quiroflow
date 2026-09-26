// What a patient-trigger automation does when the calendar fires it.
//
// A characterization spec: it pins down how /api/automations/fire behaves
// today -- which rules run, for whom, through which consent gates, and exactly
// which rows each step leaves behind -- so that the automation engine can be
// rebuilt underneath it without anything a clinic already relies on changing.
//
// Nothing here reaches Meta or Resend. WhatsApp and email steps are asserted
// through dry run, which runs every part of a send except the provider call
// and records what would have gone out; a live WhatsApp step on an account
// with no credentials is skipped, and a live email step on a deployment with
// no Resend key fails -- both leave their own evidence (or its absence).
// Webhook steps are real calls, to a receiver the spec runs.

interface SeededAccount {
  email: string
  password: string
  accountId: string
  clinicId: string
  teamMemberId: string
}

interface WhatsAppRow {
  status: string
  template_name: string
  phone_number: string
  wamid: string | null
  purpose: string
  appointment_id: string | null
  patient_id: string | null
}

interface EmailRow {
  provider_message_id: string | null
  dry_run: boolean
  rule_id: string | null
  recipient_email: string
  subject: string | null
}

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()

describe('Patient automations fired from the app', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
      cy.login(account.email, account.password)
    })
  })

  afterEach(() => {
    cy.task('db:stopWebhookReceiver')
  })

  function fire(body: Record<string, unknown>, failOnStatusCode = true) {
    return cy.request({ method: 'POST', url: '/api/automations/fire', body, failOnStatusCode })
  }

  function patient(extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Ana',
      lastName: 'Prueba',
      email: `ana.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`,
      phone: randomPhone(),
      ...extra,
    })
  }

  function appointment(patientId: string, extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('db:createAppointment', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      patientId,
      startsAt: inDays(2),
      ...extra,
    })
  }

  function rule(opts: Record<string, unknown>) {
    return cy.task<{ id: string }>('db:createAutomationRule', {
      accountId: account.accountId,
      name: 'Characterization',
      dryRun: true,
      ...opts,
    })
  }

  const whatsapp = (template = 'cita_reservada') => ({ type: 'whatsapp_template', config: { template_name: template, template_language: 'es' } })

  it('runs an enabled rule for its trigger and records the WhatsApp against the patient and the appointment', () => {
    rule({ triggerEvent: 'appointment.booked', actions: [whatsapp()] }).then((r) => {
      patient().then((p) => {
        appointment(p.id).then((appt) => {
          fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id }).its('body').should('deep.eq', { fired: 1 })
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.status).to.eq('would_send')
            expect(rows[0]!.template_name).to.eq('cita_reservada')
            expect(rows[0]!.phone_number).to.match(/^34[67]\d{8}$/)
            expect(rows[0]!.wamid).to.be.null
            expect(rows[0]!.appointment_id).to.eq(appt.id)
            expect(rows[0]!.purpose).to.eq('other')
          })
          // A rule that runs straight through leaves no run behind: runs are
          // for rules that wait.
          cy.task<unknown[]>('auto:runsForRule', { ruleId: r.id }).should('have.length', 0)
        })
      })
    })
  })

  it('ignores a disabled rule and a rule on another trigger', () => {
    rule({ triggerEvent: 'appointment.booked', enabled: false, actions: [whatsapp()] })
    rule({ triggerEvent: 'appointment.completed', actions: [whatsapp()] })
    patient().then((p) => {
      appointment(p.id).then((appt) => {
        fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id }).its('body').should('deep.eq', { fired: 0 })
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
      })
    })
  })

  it('runs every enabled rule on the trigger, each with its own steps', () => {
    rule({ triggerEvent: 'appointment.checked_in', actions: [whatsapp('bienvenida')] })
    rule({ triggerEvent: 'appointment.checked_in', actions: [whatsapp('tareas_llegada')] })
    patient().then((p) => {
      appointment(p.id).then((appt) => {
        fire({ triggerEvent: 'appointment.checked_in', patientId: p.id, appointmentId: appt.id }).its('body').should('deep.eq', { fired: 2 })
        cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
          expect(rows.map((r) => r.template_name).sort()).to.deep.eq(['bienvenida', 'tareas_llegada'])
        })
      })
    })
  })

  it('fires nothing for a patient that does not exist, and refuses a caller with no session', () => {
    rule({ triggerEvent: 'appointment.booked', actions: [whatsapp()] })
    fire({ triggerEvent: 'appointment.booked', patientId: '00000000-0000-0000-0000-000000000000' }).its('body').should('deep.eq', { fired: 0 })
    fire({ triggerEvent: 'appointment.booked' }, false).its('status').should('eq', 400)
    cy.clearAllCookies()
    cy.clearAllLocalStorage()
    fire({ triggerEvent: 'appointment.booked', patientId: '00000000-0000-0000-0000-000000000000' }, false).its('status').should('eq', 403)
  })

  it('waits at a delay in a patient rule, instead of sending every step at once', () => {
    // The one intended change of the automation engine. Until it, a delay in
    // a PATIENT rule was ignored and both messages went out together; now it
    // waits, as it always has for leads. growth-automation-engine walks the
    // rest of this run.
    rule({
      triggerEvent: 'appointment.completed',
      actions: [whatsapp('primera'), { type: 'delay', config: { delay_minutes: 1440 } }, whatsapp('segunda')],
    }).then((r) => {
      patient().then((p) => {
        appointment(p.id).then((appt) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id, appointmentId: appt.id }).its('body').should('deep.eq', { fired: 1 })
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows.map((row) => row.template_name)).to.deep.eq(['primera'])
          })
          cy.task<{ status: string; patient_id: string }[]>('auto:runsForRule', { ruleId: r.id }).then((runs) => {
            expect(runs).to.have.length(1)
            expect(runs[0]!.status).to.eq('running')
            expect(runs[0]!.patient_id).to.eq(p.id)
          })
        })
      })
    })
  })

  describe('audience filters', () => {
    // Each filter is checked from both sides: a patient it should let through
    // and one it should not. `fired` counts the rules whose filters matched.
    it('appointment type and practitioner', () => {
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita' }).then((type) => {
        cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Seguimiento' }).then((other) => {
          rule({ triggerEvent: 'appointment.booked', filters: { appointment_type_ids: [type.id], practitioner_ids: [account.teamMemberId] }, actions: [whatsapp()] })
          patient().then((p) => {
            appointment(p.id, { appointmentTypeId: type.id, practitionerId: account.teamMemberId }).then((match) => {
              fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: match.id }).its('body.fired').should('eq', 1)
            })
            appointment(p.id, { appointmentTypeId: other.id, practitionerId: account.teamMemberId }).then((wrongType) => {
              fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: wrongType.id }).its('body.fired').should('eq', 0)
            })
            appointment(p.id, { appointmentTypeId: type.id, practitionerId: null }).then((wrongPractitioner) => {
              fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: wrongPractitioner.id }).its('body.fired').should('eq', 0)
            })
            // A type filter with no appointment in the payload cannot match.
            fire({ triggerEvent: 'appointment.booked', patientId: p.id }).its('body.fired').should('eq', 0)
          })
        })
      })
    })

    it('the legacy single appointment_type_id', () => {
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Legacy' }).then((type) => {
        rule({ triggerEvent: 'appointment.booked', filters: { appointment_type_id: type.id }, actions: [whatsapp()] })
        patient().then((p) => {
          appointment(p.id, { appointmentTypeId: type.id }).then((appt) => {
            fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id }).its('body.fired').should('eq', 1)
          })
          appointment(p.id).then((appt) => {
            fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id }).its('body.fired').should('eq', 0)
          })
        })
      })
    })

    it('tag contains, case-insensitively', () => {
      rule({ triggerEvent: 'appointment.completed', filters: { tag_contains: 'vip' }, actions: [whatsapp()] })
      patient({ tags: ['Cliente VIP|10x'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
      })
      patient({ tags: ['normal'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 0)
      })
    })

    it('first visit (no prior appointments) and total completed visits', () => {
      rule({ triggerEvent: 'appointment.booked', filters: { no_prior_appointments: true }, actions: [whatsapp()] })
      rule({ triggerEvent: 'appointment.completed', filters: { total_visits: 1 }, actions: [whatsapp()] })
      patient().then((p) => {
        appointment(p.id).then((first) => {
          fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: first.id }).its('body.fired').should('eq', 1)
          appointment(p.id).then((second) => {
            fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: second.id }).its('body.fired').should('eq', 0)
          })
        })
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 0)
        appointment(p.id, { status: 'completed', startsAt: inDays(-3) }).then(() => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        })
      })
    })

    it('has a future appointment', () => {
      rule({ triggerEvent: 'appointment.completed', filters: { has_future_appointment: false }, actions: [whatsapp()] })
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        appointment(p.id, { startsAt: inDays(7) }).then(() => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 0)
        })
      })
    })

    it('balance in credit, and an active membership', () => {
      rule({ triggerEvent: 'invoice.paid', filters: { balance: 'credit' }, actions: [whatsapp()] })
      rule({ triggerEvent: 'appointment.completed', filters: { membership_active: true }, actions: [whatsapp()] })
      patient().then((p) => {
        fire({ triggerEvent: 'invoice.paid', patientId: p.id }).its('body.fired').should('eq', 0)
        cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: p.id, amountCents: 2500 })
        fire({ triggerEvent: 'invoice.paid', patientId: p.id }).its('body.fired').should('eq', 1)

        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 0)
        cy.task('auto:membershipOnStripe', { accountId: account.accountId, patientId: p.id, subscriptionId: `sub_${Date.now()}`, webhookSecret: 'whsec_unused' })
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
      })
    })
  })

  describe('who may be contacted', () => {
    const marketingRule = () =>
      rule({
        triggerEvent: 'appointment.completed',
        isMarketing: true,
        actions: [whatsapp('promo'), { type: 'email', config: { subject: 'Oferta {{first_name}}', body: '<p>Hola</p>' } }],
      })

    it('a marketing rule reaches only the channels the patient opted in to', () => {
      marketingRule()
      patient({ marketingChannels: [] }).then((p) => {
        // The rule still counts as fired -- its filters matched -- but
        // nothing is recorded, because nothing may be sent.
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
      })
      patient({ marketingChannels: ['email'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
      })
      patient({ marketingChannels: ['whatsapp'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
      })
      // The email half of the gate is pinned in growth-automation-schedules,
      // where a dry-run email leaves a row to count; through this endpoint it
      // leaves none (see "an email in dry run" below).
    })

    it('a transactional rule needs no marketing opt-in', () => {
      rule({ triggerEvent: 'appointment.completed', actions: [whatsapp()] })
      patient({ marketingChannels: [] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
      })
    })

    it('never reaches a minor or a do-not-contact patient, marketing or not', () => {
      rule({ triggerEvent: 'appointment.completed', actions: [whatsapp(), { type: 'email', config: { subject: 'Hola', body: '<p>Hola</p>' } }] })
      patient({ isMinor: true, marketingChannels: ['whatsapp', 'email'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
        cy.task('auto:emailsFor', { patientId: p.id }).should('have.length', 0)
      })
      patient({ doNotContact: true, marketingChannels: ['whatsapp', 'email'] }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
        cy.task('auto:emailsFor', { patientId: p.id }).should('have.length', 0)
      })
    })

    it('skips WhatsApp for a patient with no number, and carries on to the next step', () => {
      cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
        rule({ triggerEvent: 'appointment.completed', dryRun: false, actions: [whatsapp(), { type: 'webhook', config: { url } }] })
        patient({ phone: undefined }).then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id })
          cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
          cy.task<string[]>('db:webhookReceiverHits').should('have.length', 1)
        })
      })
    })
  })

  describe('what each step leaves behind', () => {
    it('an email in dry run leaves no row when fired from the app', () => {
      // Pinned as found, not as intended: this endpoint runs the rule with
      // the caller's own client, and email_messages refuses that insert under
      // RLS ("could not record dry-run email" in the server log). The same
      // rule run by a cron, with the service role, does record it -- see
      // growth-automation-schedules.
      rule({ triggerEvent: 'appointment.completed', actions: [{ type: 'email', config: { subject: 'Gracias {{first_name}}', body: '<p>Hola {{first_name}}</p>' } }] })
      patient({ email: 'ana.gracias@example.test' }).then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        cy.task<EmailRow[]>('auto:emailsFor', { patientId: p.id }).should('have.length', 0)
      })
    })

    it('a live email with no Resend key records nothing, and does not stop the next step', () => {
      cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
        rule({
          triggerEvent: 'appointment.completed',
          dryRun: false,
          actions: [{ type: 'email', config: { subject: 'Hola', body: '<p>Hola</p>' } }, { type: 'webhook', config: { url } }],
        })
        patient().then((p) => {
          fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
          cy.task('auto:emailsFor', { patientId: p.id }).should('have.length', 0)
          cy.task<string[]>('db:webhookReceiverHits').should('have.length', 1)
        })
      })
    })

    it('a live WhatsApp on an account with no WhatsApp connected records nothing', () => {
      rule({ triggerEvent: 'appointment.completed', dryRun: false, actions: [whatsapp()] })
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id }).its('body.fired').should('eq', 1)
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
        cy.task('auto:contactLogFor', { patientId: p.id }).should('have.length', 0)
      })
    })

    it('a webhook is called with the event, the ids and a signature', () => {
      cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
        rule({ triggerEvent: 'invoice.paid', dryRun: false, actions: [{ type: 'webhook', config: { url, secret: 's3cret' } }] })
        patient().then((p) => {
          appointment(p.id).then((appt) => {
            const invoiceId = '11111111-2222-3333-4444-555555555555'
            fire({ triggerEvent: 'invoice.paid', patientId: p.id, appointmentId: appt.id, invoiceId })
            cy.task<{ event: string; signature: string | null; body: { event: string; fired_at: string; data: Record<string, unknown> } }[]>('db:webhookReceiverCalls').then((calls) => {
              expect(calls).to.have.length(1)
              expect(calls[0]!.event).to.eq('invoice.paid')
              expect(calls[0]!.signature).to.match(/^[0-9a-f]{64}$/)
              expect(calls[0]!.body.event).to.eq('invoice.paid')
              expect(calls[0]!.body.data).to.deep.eq({ patient_id: p.id, appointment_id: appt.id, invoice_id: invoiceId })
            })
          })
        })
      })
    })

    it('a webhook is not called in dry run', () => {
      cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
        rule({ triggerEvent: 'invoice.paid', dryRun: true, actions: [{ type: 'webhook', config: { url } }] })
        patient().then((p) => {
          fire({ triggerEvent: 'invoice.paid', patientId: p.id }).its('body.fired').should('eq', 1)
          cy.task<string[]>('db:webhookReceiverHits').should('have.length', 0)
        })
      })
    })

    it("names a send of the clinic's reminder template as a reminder, and a dry run leaves the confirmation state alone", () => {
      rule({ triggerEvent: 'appointment.booked', actions: [whatsapp('recordatorio_cita')] })
      cy.task('auto:setReminderTemplate', { accountId: account.accountId, name: 'recordatorio_cita' })
      patient().then((p) => {
        appointment(p.id).then((appt) => {
          fire({ triggerEvent: 'appointment.booked', patientId: p.id, appointmentId: appt.id })
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows[0]!.purpose).to.eq('reminder')
          })
          cy.task<{ confirmation_status: string | null }>('auto:appointment', { id: appt.id }).its('confirmation_status').should('be.null')
        })
      })
    })

    it('mints no tracked review link in dry run', () => {
      cy.task('db:setGoogleReviewUrl', { accountId: account.accountId, url: 'https://g.page/r/example/review' })
      rule({
        triggerEvent: 'appointment.completed',
        actions: [{ type: 'whatsapp_template', config: { template_name: 'resena', template_language: 'es', variables: [{ source: 'first_name' }, { source: 'google_review_link' }] } }],
      })
      patient().then((p) => {
        fire({ triggerEvent: 'appointment.completed', patientId: p.id })
        cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
        cy.task('auto:reviewRequestsForPatient', { patientId: p.id }).should('have.length', 0)
      })
    })
  })
})
