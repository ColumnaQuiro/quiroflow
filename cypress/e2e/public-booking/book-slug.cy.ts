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

        cy.contains('button', 'Continuar').should('not.be.disabled').click()

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
      })
    })
  })

  it('shows a not-available message for an unknown clinic slug', () => {
    cy.visit('/book/no-such-clinic-slug-xyz')
    cy.contains('La reserva online no está disponible para esta clínica.').should('be.visible')
  })
})
