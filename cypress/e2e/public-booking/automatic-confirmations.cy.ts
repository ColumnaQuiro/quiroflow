// Confirmations and reminders sent without anyone at a screen, against the
// Meta Graph stub. Found in the settings QA round (30 Sep 2026):
// - the public confirmation endpoint sent again on every call for ten minutes;
// - "sent" was recorded when nothing had gone out;
// - a rejected template language was picked over the approved one;
// - bookings from the patient app and the API were never confirmed;
// - a visit booked inside its reminder window never got a reminder.

interface Account {
  email: string
  password: string
  accountId: string
  clinicId: string
}

const hours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString()
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

function templates(list?: { name: string; language: string; status: string; body: string }[]) {
  return cy.task('db:startMetaGraphStub', {
    templates: list ?? [{ name: 'confirmacion_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}, tu cita es el {{2}}.' }],
  })
}

function patient(account: Account, withPhone = true) {
  const phone = `+346${Math.floor(10000000 + Math.random() * 89999999)}`
  return cy
    .task<{ id: string }>('db:createPatient', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      firstName: 'Lucía',
      ...(withPhone ? { phone } : {}),
    })
    .then((p) => ({ id: p.id, phone }))
}

// The crons act for every account in the database, so a spec reads only the
// sends addressed to its own patient.
// WhatsApp takes the number as digits, no '+'.
const sendsTo = (phone: string) => cy.task<any[]>('db:metaGraphStubSends').then((all) => all.filter((m) => m?.to === phone.replace(/\D/g, '')))

function booking(account: Account, patientId: string, opts: { source?: string; startsAt?: string; createdAt?: string } = {}) {
  return cy.task<{ id: string }>('db:createAppointment', {
    accountId: account.accountId,
    clinicId: account.clinicId,
    patientId,
    startsAt: opts.startsAt ?? hours(48),
    source: opts.source ?? 'online',
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  })
}

function confirmFromBookingPage(account: Account, appointmentId: string) {
  return cy.task<{ slug: string }[]>('db:selectRows', { table: 'accounts', columns: 'slug', match: { id: account.accountId } }).then((rows) =>
    cy.request({ method: 'POST', url: '/api/public-booking/send-confirmation', body: { accountSlug: rows[0]!.slug, appointmentId } }),
  )
}

const state = (appointmentId: string) =>
  cy.task<{ confirmation_sent_at: string | null; reminder_sent_at: string | null; auto_confirmation_claimed_at: string | null }>('db:appointmentMessageState', { appointmentId })
const runCron = () =>
  cy.request({ method: 'POST', url: '/api/automations/appointment-reminders-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })

describe('Automatic confirmations and reminders', () => {
  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it('confirms a booking from the public page once, however many times it is asked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      templates()
      patient(account).then((p) =>
        booking(account, p.id).then((appt) => {
          confirmFromBookingPage(account, appt.id)
          confirmFromBookingPage(account, appt.id)
          confirmFromBookingPage(account, appt.id)
          sendsTo(p.phone).should('have.length', 1)
          state(appt.id).its('confirmation_sent_at').should('not.eq', null)
        }),
      )
    })
  })

  it('records nothing as sent when nothing could be sent', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      templates()
      // No number to send to.
      patient(account, false).then((p) =>
        booking(account, p.id).then((appt) => {
          confirmFromBookingPage(account, appt.id)
          sendsTo(p.phone).should('have.length', 0)
          state(appt.id).then((s) => {
            expect(s.auto_confirmation_claimed_at).to.not.eq(null)
            expect(s.confirmation_sent_at).to.eq(null)
          })
        }),
      )
    })
  })

  it('records nothing as sent when Meta refuses the send', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      cy.task('db:startMetaGraphStub', { failSends: true, templates: [{ name: 'confirmacion_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}.' }] })
      patient(account).then((p) =>
        booking(account, p.id).then((appt) => {
          confirmFromBookingPage(account, appt.id)
          sendsTo(p.phone).should('have.length', 1)
          state(appt.id).its('confirmation_sent_at').should('eq', null)
        }),
      )
    })
  })

  it('sends the approved language of a template, never a rejected one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId, templateLanguage: 'en' })
      templates([
        { name: 'confirmacion_cita', language: 'es', status: 'REJECTED', body: 'Hola {{1}}.' },
        { name: 'confirmacion_cita', language: 'en', status: 'APPROVED', body: 'Hi {{1}}.' },
      ])
      patient(account).then((p) =>
        booking(account, p.id).then((appt) => {
          confirmFromBookingPage(account, appt.id)
          sendsTo(p.phone).its('0.template.language.code').should('eq', 'en')
        }),
      )
    })
  })

  it('confirms a booking made through the API', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      templates()
      patient(account).then((p) =>
        cy.task<{ token: string }>('db:createApiToken', { accountId: account.accountId, scopes: ['appointments:write'] }).then(({ token }) => {
          cy.request({
            method: 'POST',
            url: '/api/public/v1/appointments',
            headers: { Authorization: `Bearer ${token}` },
            body: { patient_id: p.id, clinic_id: account.clinicId, starts_at: hours(48), ends_at: hours(48.5) },
          }).then((res) => {
            expect(res.status).to.eq(201)
            sendsTo(p.phone).should('have.length', 1)
            state(res.body.data.id).its('confirmation_sent_at').should('not.eq', null)
          })
        }),
      )
    })
  })

  it('confirms a booking from the patient app, which calls nothing afterwards, from the cron', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId })
      templates()
      patient(account).then((p) =>
        booking(account, p.id, { createdAt: minutesAgo(5) }).then((appt) => {
          runCron()
          runCron()
          state(appt.id).then((s) => {
            expect(s.auto_confirmation_claimed_at).to.not.eq(null)
            expect(s.confirmation_sent_at).to.not.eq(null)
          })
          sendsTo(p.phone).should('have.length', 1)
        }),
      )
    })
  })

  it('reminds a visit booked inside its reminder window, unless its confirmation went out', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setAutomaticMessages', { accountId: account.accountId, confirmation: false, reminder: true, reminderHoursBefore: 24 })
      templates()
      patient(account).then((p) =>
        // Booked now for five hours' time: the 24-hour window has passed it by.
        booking(account, p.id, { source: 'staff', startsAt: hours(5) }).then((appt) => {
          runCron()
          state(appt.id).its('reminder_sent_at').should('not.eq', null)
        }),
      )
      patient(account).then((p) =>
        // Less than two hours ahead: too close for a reminder to help.
        booking(account, p.id, { source: 'staff', startsAt: hours(1) }).then((appt) => {
          runCron()
          state(appt.id).its('reminder_sent_at').should('eq', null)
        }),
      )
    })
  })
})
