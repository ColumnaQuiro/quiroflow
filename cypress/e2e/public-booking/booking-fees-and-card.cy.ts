import { seedVisit } from '../../support/calendar'

// Fees for a late cancellation or a no-show, said on the booking page before
// anyone books (get_public_booking_policy); the card step after booking when
// the clinic asks for one (the Stripe card page itself is Stripe's, so its
// link is stubbed here); and the no-show fee offered from the visit, on the
// balance or the card (/api/appointments/cancellation-fee, kind 'missed').

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

describe('Booking fees and a card on file', () => {
  it('tells the patient the fees before booking, and asks for a card after', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:updateRows', { table: 'accounts', values: { cancellation_fee_cents: 1500, missed_appointment_fee_cents: 2500, online_booking_card_on_file: true, stripe_publishable_key: 'pk_test_example' }, match: { id: account.accountId } })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, onlineBookingEnabled: true }).then(() => {
        // Stripe is not reachable from CI: the booking answers with a card page of our own choosing.
        cy.intercept('POST', '/api/public-booking/book', (req) => {
          req.continue((res) => {
            res.body = { ...res.body, card_url: 'https://checkout.stripe.example/setup' }
          })
        }).as('book')
        cy.visit(`/book/${account.accountSlug}`)
        selectBookableDayWithSlots()
        cy.contains('button', /^\d{2}:\d{2}$/).first().click()
        cy.contains('Introduzca sus datos').should('be.visible')
        cy.get('[data-cy=booking-policy]')
          .should('contain.text', 'Cancelar con menos de 24 h de antelación: 15,00')
          .and('contain.text', 'No presentarse a la cita: 25,00')
          .and('contain.text', 'te pediremos una tarjeta')
        cy.contains('label', 'Nombre *').parent().find('input').type('Nora')
        cy.contains('label', 'Correo electrónico *').parent().find('input').type('nora.tarjeta@example.test')
        cy.contains('label', 'Número de móvil *').parent().find('input[type="tel"]').type('600111002')
        cy.contains('button', 'Reservar cita').click()
        cy.wait('@book')
        cy.get('[data-cy=booking-card-step]').should('contain.text', 'Tu cita está reservada').and('contain.text', 'No se cobra nada ahora')
        cy.get('[data-cy=booking-add-card]').should('be.visible')
        // Without one, the booking stands.
        cy.get('[data-cy=booking-skip-card]').click()
        cy.contains('¡Cita reservada!').should('be.visible')
      })
    })
  })

  it('offers the no-show fee from the visit, and puts it on the balance', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateRows', { table: 'accounts', values: { missed_appointment_fee_cents: 2500 }, match: { id: account.accountId } })
      seedVisit(account, null, 'Leo', 'Faltó', 10, 0).then(({ patientId }) => {
        cy.login(account.email, account.password)
        cy.visit('/practitioner')
        cy.contains('li', 'Leo Faltó').find('[data-cy=practitioner-open-appointment]').click({ force: true })
        cy.get('[data-cy=mark-no-show]').click()
        cy.get('[data-cy=missed-fee]').should('contain.text', '25,00')
        // No card on file in CI: only the balance is offered.
        cy.get('[data-cy=missed-fee-card]').should('not.exist')
        cy.get('[data-cy=missed-fee-balance]').click()
        cy.get('[data-cy=missed-fee-result]').should('contain.text', 'balance')
        cy.task<{ total_cents: number; status: string }[]>('db:selectRows', { table: 'invoices', columns: 'total_cents, status', match: { patient_id: patientId } }).then((rows) => {
          expect(rows).to.have.length(1)
          expect(rows[0]).to.deep.include({ total_cents: 2500, status: 'unpaid' })
        })
      })
    })
  })
})
