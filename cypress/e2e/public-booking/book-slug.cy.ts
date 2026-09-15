import { appStoreUrl, playStoreUrl } from '../../../utils/appLinks'

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

function attributionRow(accountId: string, attempt = 0): Cypress.Chainable<Record<string, string | null>> {
  return cy.task<{ rows: Record<string, string | null>[] }>('db:bookingAttribution', { accountId }).then((r) => {
    if (r.rows.length > 0) return cy.wrap(r.rows[0])
    if (attempt > 20) throw new Error('No booking_attribution row was written')
    cy.wait(250)
    return attributionRow(accountId, attempt + 1)
  })
}

describe('Public online booking', () => {
  it('books an appointment as an unauthenticated visitor', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:enableEmailConfirmations', { accountId: account.accountId })
      cy.task('db:createAppointmentType', {
        accountId: account.accountId,
        name: 'Consultation',
        durationMinutes: 30,
        onlineBookingEnabled: true,
      }).then(() => {
        cy.visit(`/book/${account.accountSlug}`)

        // A single practitioner is no real choice, so the widget skips the
        // practitioner-selection step (and its "Continuar" button) entirely.
        cy.contains('Elija su fecha y hora').should('be.visible')
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()

        cy.contains('Introduzca sus datos').should('be.visible')
        cy.contains('label', 'Nombre *').parent().find('input').type('Maria')
        cy.contains('label', 'Apellidos').parent().find('input').type('Garcia')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type('maria.garcia@example.test')
        cy.contains('button', 'Reservar cita').click()

        cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')
        cy.contains('Le hemos enviado los detalles a maria.garcia@example.test.').should('be.visible')

        // The install prompt rides on the confirmation. Spanish whatever the
        // viewer's language preference says, because this page is read by the
        // patient and never by the staff member that preference belongs to.
        cy.contains('Descarga la app de QuiroFlow').should('be.visible')
        cy.get('a[href*="play.google.com"]').should('have.attr', 'href', playStoreUrl())

        // Asserted against the constant rather than a hard-coded state, so
        // this keeps holding once the App Store's numeric ID is filled in
        // instead of failing the day someone adds it.
        if (appStoreUrl()) {
          cy.get('a[href*="apps.apple.com"]').should('have.attr', 'href', appStoreUrl())
        } else {
          cy.get('a[href*="apps.apple.com"]').should('not.exist')
        }
      })
    })
  })

  it('records where an ad-driven booking came from', () => {
    // The gap this closes: an online booking used to arrive with nothing but
    // source='online'. Someone who clicked a Meta ad and booked was
    // indistinguishable from someone who typed the URL in, which is how a
    // real lead -- in the Meta Leads Center three days earlier -- looked like
    // she appeared from nowhere.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', {
        accountId: account.accountId,
        name: 'Consultation',
        durationMinutes: 30,
        onlineBookingEnabled: true,
      }).then(() => {
        cy.visit(`/book/${account.accountSlug}?utm_source=facebook&utm_medium=paid&utm_campaign=oferta-primera-visita&fbclid=IwAR_test_click_id`)

        cy.contains('Elija su fecha y hora').should('be.visible')
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()

        cy.contains('Introduzca sus datos').should('be.visible')
        cy.contains('label', 'Nombre *').parent().find('input').type('Marta')
        cy.contains('label', 'Apellidos').parent().find('input').type('Diaz')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type('marta.attrib@example.test')
        cy.contains('button', 'Reservar cita').click()

        cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')

        // Written fire-and-forget after the booking, so it can land a moment
        // after the success screen -- retried rather than asserted once.
        attributionRow(account.accountId).then((row) => {
          expect(row.utm_source).to.eq('facebook')
          expect(row.utm_medium).to.eq('paid')
          expect(row.utm_campaign).to.eq('oferta-primera-visita')
          // The click id is what joins this booking back to Meta's own
          // reporting, and the platform is derived from which param carried it.
          expect(row.click_id).to.eq('IwAR_test_click_id')
          expect(row.click_id_source).to.eq('meta')
          expect(row.landing_path).to.contain('utm_source=facebook')
        })

        cy.task<{ rows: unknown[] }>('db:bookingAttribution', { accountId: account.accountId }).then(({ rows }) => {
          expect(rows, 'exactly one row per booking, never a duplicate').to.have.length(1)
        })
      })
    })
  })

  it('writes no attribution row for a booking that carries none', () => {
    // Most bookings are direct. Those must not leave a row of nulls behind,
    // or every report has to filter them out again.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', {
        accountId: account.accountId,
        name: 'Consultation',
        durationMinutes: 30,
        onlineBookingEnabled: true,
      }).then(() => {
        cy.visit(`/book/${account.accountSlug}`)

        cy.contains('Elija su fecha y hora').should('be.visible')
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()

        cy.contains('Introduzca sus datos').should('be.visible')
        cy.contains('label', 'Nombre *').parent().find('input').type('Directo')
        cy.contains('label', 'Apellidos').parent().find('input').type('Visitante')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type('directo@example.test')
        cy.contains('button', 'Reservar cita').click()

        cy.contains('¡Cita reservada!', { timeout: 15000 }).should('be.visible')

        // The request still fires -- it is the server that decides there is
        // nothing to record -- so give it time to land before asserting it
        // did not, otherwise this passes for the wrong reason.
        cy.wait(2000)
        cy.task<{ rows: unknown[] }>('db:bookingAttribution', { accountId: account.accountId }).then(({ rows }) => {
          expect(rows, 'no row for a direct booking').to.have.length(0)
        })
      })
    })
  })

  it('shows a not-available message for an unknown clinic slug', () => {
    cy.visit('/book/no-such-clinic-slug-xyz')
    cy.contains('La reserva online no está disponible para esta clínica.').should('be.visible')
  })
})
