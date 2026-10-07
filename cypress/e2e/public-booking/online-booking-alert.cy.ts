// The clinic's "new online booking" alert, against the Meta Graph stub.
//
// It was sent by a request the booking page fired after the booking, just
// before redirecting to the clinic's thank-you page, and the redirect
// cancelled it whenever it had not left yet: six of Columnaquiro's sixteen
// online bookings between 21 and 28 Sep 2026 alerted nobody. The booking now
// goes through /api/public-booking/book, which alerts before it answers, and
// the confirmation endpoint and the reminders cron still offer it -- so what
// matters is that it arrives by the time the patient sees "Cita reservada",
// and arrives once.

interface Account {
  accountId: string
  accountSlug: string
  clinicId: string
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()
const hours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString()

function selectBookableDayWithSlots(attempt = 0) {
  cy.get('.grid.grid-cols-7 button:not([disabled])').eq(attempt).click()
  cy.contains('Cargando horarios').should('not.exist')
  cy.get('body').then(($body) => {
    if ($body.text().includes('No hay horas disponibles')) {
      if (attempt > 15) throw new Error('No bookable day within the visible range had available slots')
      selectBookableDayWithSlots(attempt + 1)
    }
  })
}

// WhatsApp connected (stubbed), and alerts going to a number of the spec's own:
// the cron acts for every account in the database, so only sends to this
// number belong to this test.
function clinicWithAlerts(account: Account) {
  const notify = `+346${Math.floor(10000000 + Math.random() * 89999999)}`
  cy.task('db:setAutomaticMessages', { accountId: account.accountId })
  cy.task('db:startMetaGraphStub', { templates: [{ name: 'confirmacion_cita', language: 'es', status: 'APPROVED', body: 'Hola {{1}}.' }] })
  cy.task('db:updateRows', { table: 'accounts', values: { online_booking_notify_whatsapp: notify }, match: { id: account.accountId } })
  return cy.wrap(notify)
}

const alertsTo = (notify: string) =>
  cy.task<any[]>('db:metaGraphStubSends').then((all) => all.filter((m) => String(m?.to ?? '').replace(/\D/g, '') === notify.replace(/\D/g, '')))

const runCron = () =>
  cy.request({ method: 'POST', url: '/api/automations/appointment-reminders-cron', headers: { 'x-cron-secret': Cypress.env('CRON_SECRET') ?? '' } })

function onlineBooking(account: Account, opts: { createdAt: string }) {
  const phone = `+346${Math.floor(10000000 + Math.random() * 89999999)}`
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', phone }).then((p) =>
    cy.task<{ id: string }>('db:createAppointment', {
      accountId: account.accountId,
      clinicId: account.clinicId,
      patientId: p.id,
      startsAt: hours(48),
      source: 'online',
      createdAt: opts.createdAt,
    }),
  )
}

describe('New online booking alert', () => {
  afterEach(() => {
    cy.task('db:stopMetaGraphStub')
  })

  it('has reached the clinic by the time the patient sees the booking made, without the page\'s follow-up request, and only once', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, onlineBookingEnabled: true })
      clinicWithAlerts(account).then((notify) => {
        // What the thank-you redirect did in production: the page's own
        // follow-up request never arrives. The alert must not depend on it.
        cy.intercept('POST', '/api/public-booking/send-confirmation', { forceNetworkError: true })
        cy.visit(`/book/${account.accountSlug}`)
        cy.contains('Elija su fecha y hora').should('be.visible')
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()
        cy.contains('label', 'Nombre *').parent().find('input').type('Maria')
        cy.contains('label', 'Apellidos').parent().find('input').type('Garcia')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type(`maria.${Date.now()}@example.test`)
        cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111001')
        cy.contains('button', 'Reservar cita').click()
        cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')

        // Read once, not retried: the booking request does not answer until
        // the alert has gone, so it is already there or it is missing.
        alertsTo(notify).then((sends) => {
          expect(sends).to.have.length(1)
          expect(sends[0].text.body).to.contain('Maria Garcia')
        })

        // The confirmation request (cy.request is not intercepted) and the
        // cron's catch-up both offer the alert again, and both find it taken.
        cy.task<{ id: string }[]>('db:selectRows', { table: 'appointments', columns: 'id', match: { account_id: account.accountId, source: 'online' } }).then((rows) => {
          expect(rows).to.have.length(1)
          cy.request({ method: 'POST', url: '/api/public-booking/send-confirmation', body: { accountSlug: account.accountSlug, appointmentId: rows[0]!.id } })
          cy.task('db:updateRows', { table: 'appointments', values: { created_at: minutesAgo(5) }, match: { id: rows[0]!.id } })
        })
        runCron()
        alertsTo(notify).should('have.length', 1)
      })
    })
  })

  it('is sent by the cron for an online booking nothing else alerted about, once', () => {
    // The patient app's bookings are 'online' and pass through no endpoint of
    // ours; the cron's catch-up is what alerts for them.
    cy.seedStaffAccount().then((account) => {
      clinicWithAlerts(account).then((notify) => {
        onlineBooking(account, { createdAt: minutesAgo(5) }).then(() => {
          runCron()
          alertsTo(notify).should('have.length', 1)
          runCron()
          alertsTo(notify).should('have.length', 1)
        })
      })
    })
  })

  it('is not sent again for a booking the previous code already confirmed', () => {
    // No backfill of staff_alert_claimed_at: a booking whose confirmation was
    // already claimed was alerted about by the code that claimed it.
    cy.seedStaffAccount().then((account) => {
      clinicWithAlerts(account).then((notify) => {
        onlineBooking(account, { createdAt: minutesAgo(5) }).then((appt) => {
          cy.task('db:updateRows', { table: 'appointments', values: { auto_confirmation_claimed_at: minutesAgo(5) }, match: { id: appt.id } })
          runCron()
          alertsTo(notify).should('have.length', 0)
        })
      })
    })
  })
})
