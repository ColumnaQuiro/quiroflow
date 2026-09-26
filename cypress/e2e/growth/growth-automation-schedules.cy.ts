// The automations nobody clicks: the scheduled triggers (birthday, same day,
// hours before, review request) and the two manual sends from the campaign
// editor (Send now, Send test to me).
//
// A characterization spec, like growth-automation-fire: it records what each
// path does today -- who it reaches, which rows it writes, and what stops it
// sending twice -- so the engine can change underneath without any of it
// moving. Sends are asserted through dry run (see that spec for why).
//
// The crons read every account in the database, not just this spec's. Each
// test therefore asserts on its own patient's rows rather than on the count
// the cron returns, and switches its rules off afterwards so a later run of
// the suite does not keep firing them.

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

const randomPhone = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
const HOUR = 3600 * 1000

describe('Scheduled and manual automation sends', () => {
  let account: SeededAccount

  beforeEach(() => {
    cy.seedStaffAccount().then((seeded) => {
      account = seeded as unknown as SeededAccount
    })
  })

  afterEach(() => {
    if (account) cy.task('auto:disableRules', { accountId: account.accountId })
    cy.task('db:stopWebhookReceiver')
  })

  function cron(path: string) {
    return cy.request({ method: 'POST', url: `/api/automations/${path}`, headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })
  }

  function patient(extra: Record<string, unknown> = {}) {
    return cy.task<{ id: string }>('auto:patient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Bea',
      lastName: 'Programada',
      phone: randomPhone(),
      ...extra,
    })
  }

  function rule(opts: Record<string, unknown>) {
    return cy.task<{ id: string }>('db:createAutomationRule', { accountId: account.accountId, name: 'Scheduled', dryRun: true, ...opts })
  }

  const whatsapp = (template: string) => ({ type: 'whatsapp_template', config: { template_name: template, template_language: 'es' } })

  it('refuses every cron without the shared secret', () => {
    for (const path of ['birthday-cron', 'same-day-cron', 'hours-before-cron', 'review-request-cron', 'lead-sequence-cron']) {
      cy.request({ method: 'POST', url: `/api/automations/${path}`, headers: { 'x-cron-secret': 'wrong' }, failOnStatusCode: false }).its('status').should('eq', 401)
    }
  })

  describe('birthday', () => {
    // "Today" is the clinic's date (automations phase 3). Each test pins the
    // clinic's zone, then works out what today is there.
    const dateIn = (zone: string, at = new Date()) => {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]),
      )
      return `${parts.year}-${parts.month}-${parts.day}`
    }
    const born = (date: string) => `1990-${date.slice(5)}`

    it("messages the patients whose birthday it is today, through the rule filters -- once a day", () => {
      cy.task('auto:setClinicTimezone', { clinicId: account.clinicId, timezone: 'Etc/UTC' })
      const today = dateIn('Etc/UTC')
      const tomorrow = dateIn('Etc/UTC', new Date(Date.now() + 24 * HOUR))
      rule({ triggerEvent: 'patient.birthday', filters: { tag_contains: 'cumple' }, actions: [whatsapp('feliz_cumple')] })
      patient({ dateOfBirth: born(today), tags: ['cumple-si'] }).then((p) => {
        patient({ dateOfBirth: born(today), tags: [] }).then((filteredOut) => {
          patient({ dateOfBirth: born(tomorrow), tags: ['cumple-si'] }).then((notToday) => {
            cron('birthday-cron').its('status').should('eq', 200)
            cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
              expect(rows).to.have.length(1)
              expect(rows[0]!.template_name).to.eq('feliz_cumple')
              expect(rows[0]!.appointment_id).to.be.null
            })
            cy.task('auto:whatsappFor', { patientId: filteredOut.id }).should('have.length', 0)
            cy.task('auto:whatsappFor', { patientId: notToday.id }).should('have.length', 0)

            // Changed deliberately in automations phase 3: a second call the
            // same day used to send again. It now finds the day claimed.
            cron('birthday-cron')
            cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
          })
        })
      })
    })

    it("uses the clinic's date, not UTC's, when the two differ", () => {
      // A zone where it is already another day than in UTC right now:
      // UTC+14 is ahead from 10:00 UTC, UTC-12 behind until 12:00 UTC, so one
      // of them always is -- the same situation as Madrid between 22:00 and
      // 24:00 UTC.
      const zone = dateIn('Etc/GMT-14') !== dateIn('Etc/UTC') ? 'Etc/GMT-14' : 'Etc/GMT+12'
      const clinicToday = dateIn(zone)
      const utcToday = dateIn('Etc/UTC')
      expect(clinicToday).to.not.eq(utcToday)
      cy.task('auto:setClinicTimezone', { clinicId: account.clinicId, timezone: zone })
      rule({ triggerEvent: 'patient.birthday', actions: [whatsapp('feliz_cumple')] })
      patient({ dateOfBirth: born(clinicToday) }).then((clinicBirthday) => {
        patient({ dateOfBirth: born(utcToday) }).then((utcBirthday) => {
          cron('birthday-cron').its('status').should('eq', 200)
          cy.task('auto:whatsappFor', { patientId: clinicBirthday.id }).should('have.length', 1)
          cy.task('auto:whatsappFor', { patientId: utcBirthday.id }).should('have.length', 0)
          cy.task<{ local_date: string }[]>('auto:birthdaySends', { patientId: clinicBirthday.id }).then((rows) => {
            expect(rows.map((r) => r.local_date)).to.deep.eq([clinicToday])
          })
        })
      })
    })
  })

  describe('same day', () => {
    // The cron sends between 9:00 and 9:20 in each clinic's own time zone. So
    // rather than waiting for 9:00, the clinic is moved to a zone where it is
    // 9:0x right now. Whole-hour zones cover the first twenty minutes of every
    // UTC hour, and the half- and three-quarter-hour zones most of the rest.
    const ZONES = [
      ...Array.from({ length: 27 }, (_, i) => i - 12).map((h) => `Etc/GMT${h === 0 ? '' : h > 0 ? `-${h}` : `+${-h}`}`),
      'Asia/Kolkata',
      'Asia/Kathmandu',
      'Australia/Darwin',
      'Asia/Kabul',
      'Pacific/Marquesas',
      'Australia/Eucla',
    ]
    function zoneAtNineNow(): string | null {
      const now = new Date()
      for (const zone of ZONES) {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
        const hour = Number(parts.find((p) => p.type === 'hour')!.value)
        const minute = Number(parts.find((p) => p.type === 'minute')!.value)
        // A minute of slack at the end so the request lands inside the window.
        if (hour === 9 && minute < 18) return zone
      }
      return null
    }

    it("messages today's booked appointments once, and marks each one sent", function () {
      const zone = zoneAtNineNow()
      if (!zone) {
        cy.log('No time zone is at 9:00-9:18 right now; nothing to test against.')
        this.skip()
      }
      cy.task('auto:setClinicTimezone', { clinicId: account.clinicId, timezone: zone })
      cy.task<{ id: string }>('db:createAppointmentType', { accountId: account.accountId, name: 'Hoy' }).then((type) => {
        rule({ triggerEvent: 'appointment.same_day', filters: { appointment_type_ids: [type.id] }, actions: [whatsapp('info_hoy')] })
        patient().then((p) => {
          cy.task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
            appointmentTypeId: type.id,
          }).then((appt) => {
            cy.task<{ id: string }>('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: p.id,
              startsAt: new Date(Date.now() + 3 * HOUR).toISOString(),
            }).then((untyped) => {
              cron('same-day-cron').its('status').should('eq', 200)
              cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
                expect(rows).to.have.length(1)
                expect(rows[0]!.template_name).to.eq('info_hoy')
                expect(rows[0]!.appointment_id).to.eq(appt.id)
              })
              cy.task<{ same_day_info_sent_at: string | null }>('auto:appointment', { id: appt.id }).its('same_day_info_sent_at').should('be.a', 'string')
              // No rule matched it, so it is not marked -- a rule added later
              // still gets its chance.
              cy.task<{ same_day_info_sent_at: string | null }>('auto:appointment', { id: untyped.id }).its('same_day_info_sent_at').should('be.null')

              cron('same-day-cron')
              cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
            })
          })
        })
      })
    })
  })

  describe('hours before', () => {
    it('messages an appointment entering its window once per rule, tracked in automation_rule_sends', () => {
      rule({ triggerEvent: 'appointment.hours_before', filters: { hours_before: 3 }, actions: [whatsapp('tres_horas')] }).then((r) => {
        rule({ triggerEvent: 'appointment.hours_before', filters: { hours_before: 30 }, actions: [whatsapp('treinta_horas')] }).then((later) => {
          patient().then((p) => {
            cy.task<{ id: string }>('db:createAppointment', {
              accountId: account.accountId,
              clinicId: account.clinicId,
              patientId: p.id,
              startsAt: new Date(Date.now() + 3 * HOUR + 5 * 60 * 1000).toISOString(),
            }).then((appt) => {
              cron('hours-before-cron').its('status').should('eq', 200)
              cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
                expect(rows.map((row) => row.template_name)).to.deep.eq(['tres_horas'])
                expect(rows[0]!.appointment_id).to.eq(appt.id)
              })
              cy.task<{ appointment_id: string }[]>('auto:ruleSends', { ruleId: r.id }).then((sends) => {
                expect(sends.map((s) => s.appointment_id)).to.deep.eq([appt.id])
              })
              cy.task('auto:ruleSends', { ruleId: later.id }).should('have.length', 0)

              cron('hours-before-cron')
              cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
            })
          })
        })
      })
    })

    it('records a dry-run email merged, addressed and attributed, and gates marketing per channel', () => {
      rule({
        triggerEvent: 'appointment.hours_before',
        isMarketing: true,
        filters: { hours_before: 5 },
        actions: [whatsapp('cinco_horas'), { type: 'email', config: { subject: 'Hasta luego {{first_name}}', body: '<p>Hola {{first_name}}</p>' } }],
      }).then((r) => {
        patient({ email: 'bea.email@example.test', marketingChannels: ['email'] }).then((p) => {
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            startsAt: new Date(Date.now() + 5 * HOUR + 5 * 60 * 1000).toISOString(),
          })
          cron('hours-before-cron')
          // Opted in to email only: the email is recorded, the WhatsApp is not.
          cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
          cy.task<{ provider_message_id: string | null; dry_run: boolean; rule_id: string; recipient_email: string; subject: string }[]>('auto:emailsFor', { patientId: p.id }).then((rows) => {
            expect(rows).to.have.length(1)
            expect(rows[0]!.subject).to.eq('Hasta luego Bea')
            expect(rows[0]!.recipient_email).to.eq('bea.email@example.test')
            expect(rows[0]!.rule_id).to.eq(r.id)
            expect(rows[0]!.dry_run).to.eq(true)
            expect(rows[0]!.provider_message_id).to.be.null
          })
        })
      })
    })

    it('does not message a cancelled appointment in the window', () => {
      rule({ triggerEvent: 'appointment.hours_before', filters: { hours_before: 4 }, actions: [whatsapp('cuatro_horas')] }).then((r) => {
        patient().then((p) => {
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            status: 'cancelled',
            startsAt: new Date(Date.now() + 4 * HOUR + 5 * 60 * 1000).toISOString(),
          })
          cron('hours-before-cron')
          cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
          cy.task('auto:ruleSends', { ruleId: r.id }).should('have.length', 0)
        })
      })
    })
  })

  describe('review request', () => {
    it('messages a completed visit N days after it ended, once, and not an uncompleted one', () => {
      rule({ triggerEvent: 'appointment.review_request', filters: { days_after: 2 }, actions: [whatsapp('resena')] }).then((r) => {
        patient().then((p) => {
          const endedTwoDaysAgo = new Date(Date.now() - 48 * HOUR + 5 * 60 * 1000 - 30 * 60 * 1000).toISOString()
          cy.task<{ id: string }>('db:createAppointment', {
            accountId: account.accountId,
            clinicId: account.clinicId,
            patientId: p.id,
            status: 'completed',
            startsAt: endedTwoDaysAgo,
          }).then((appt) => {
            patient().then((noShow) => {
              cy.task('db:createAppointment', {
                accountId: account.accountId,
                clinicId: account.clinicId,
                patientId: noShow.id,
                status: 'no_show',
                startsAt: endedTwoDaysAgo,
              })
              cron('review-request-cron').its('status').should('eq', 200)
              cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
                expect(rows.map((row) => row.template_name)).to.deep.eq(['resena'])
                expect(rows[0]!.appointment_id).to.eq(appt.id)
              })
              cy.task('auto:whatsappFor', { patientId: noShow.id }).should('have.length', 0)
              cy.task('auto:ruleSends', { ruleId: r.id }).should('have.length', 1)
              cron('review-request-cron')
              cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 1)
            })
          })
        })
      })
    })
  })

  describe('Send now', () => {
    it("runs a campaign's steps for one patient, waiting at a delay", () => {
      // Every step used to go out at once, straight past the delay. Since the
      // automation engine a delay waits, here as everywhere; the rest of the
      // campaign is a run the tick picks up.
      rule({
        triggerEvent: 'appointment.completed',
        enabled: false,
        actions: [whatsapp('uno'), { type: 'delay', config: { delay_minutes: 60 } }, whatsapp('dos')],
      }).then((r) => {
        patient().then((p) => {
          cy.login(account.email, account.password)
          cy.request({ method: 'POST', url: '/api/automations/send-now', body: { ruleId: r.id, patientId: p.id } }).its('body').should('deep.eq', { sent: true })
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows.map((row) => row.template_name)).to.deep.eq(['uno'])
          })
          cy.task('auto:makeRunsDue', { ruleId: r.id })
          cron('lead-sequence-cron')
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows.map((row) => row.template_name)).to.deep.eq(['uno', 'dos'])
          })
        })
      })
    })

    it('sends a campaign with no delay straight through, leaving no run', () => {
      rule({ triggerEvent: 'appointment.completed', enabled: false, actions: [whatsapp('uno'), whatsapp('dos')] }).then((r) => {
        patient().then((p) => {
          cy.login(account.email, account.password)
          cy.request({ method: 'POST', url: '/api/automations/send-now', body: { ruleId: r.id, patientId: p.id } }).its('body').should('deep.eq', { sent: true })
          cy.task<WhatsAppRow[]>('auto:whatsappFor', { patientId: p.id }).then((rows) => {
            expect(rows.map((row) => row.template_name)).to.deep.eq(['uno', 'dos'])
          })
          cy.task('auto:runsForRule', { ruleId: r.id }).should('have.length', 0)
        })
      })
    })

    it("refuses another account's campaign and an unknown patient", () => {
      rule({ triggerEvent: 'appointment.completed', actions: [whatsapp('uno')] }).then((r) => {
        patient().then((p) => {
          cy.seedStaffAccount().then((other) => {
            cy.login(other.email, other.password)
            cy.request({ method: 'POST', url: '/api/automations/send-now', body: { ruleId: r.id, patientId: p.id }, failOnStatusCode: false }).its('status').should('eq', 404)
          })
          cy.login(account.email, account.password)
          cy.request({ method: 'POST', url: '/api/automations/send-now', body: { ruleId: r.id, patientId: '00000000-0000-0000-0000-000000000000' }, failOnStatusCode: false })
            .its('status')
            .should('eq', 404)
          cy.task('auto:whatsappFor', { patientId: p.id }).should('have.length', 0)
        })
      })
    })
  })

  describe('Send test to me', () => {
    it('calls a webhook step for real and reports success', () => {
      cy.task<{ url: string }>('db:startWebhookReceiver').then(({ url }) => {
        cy.login(account.email, account.password)
        cy.request({ method: 'POST', url: '/api/automations/send-test', body: { actions: [{ action_type: 'webhook', config: { url } }] } }).then((res) => {
          expect(res.body).to.deep.eq({ sent: true, email: null, whatsappNumber: null })
        })
        cy.task<string[]>('db:webhookReceiverHits').should('deep.eq', ['manual'])
      })
    })

    it('reports why an email step could not be sent, instead of a green tick', () => {
      cy.login(account.email, account.password)
      cy.request({
        method: 'POST',
        url: '/api/automations/send-test',
        body: { actions: [{ action_type: 'email', config: { subject: 'Prueba', body: '<p>Hola</p>' } }] },
        failOnStatusCode: false,
      }).then((res) => {
        expect(res.status).to.eq(502)
      })
    })

    it('asks for a number before testing a WhatsApp step', () => {
      cy.login(account.email, account.password)
      cy.request({
        method: 'POST',
        url: '/api/automations/send-test',
        body: { actions: [{ action_type: 'whatsapp_template', config: { template_name: 'x' } }] },
        failOnStatusCode: false,
      }).its('status').should('eq', 400)
    })
  })
})
