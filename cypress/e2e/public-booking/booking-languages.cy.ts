// The public booking page in Spanish, English or French, and the language a
// patient books in kept as their preferred_language -- which is what the
// WhatsApp templates after the booking are chosen by (#820).
//
// ?lang= decides first, then the browser, then Spanish. Visits to /book/ are
// made by a Spanish browser unless a spec says otherwise (cypress/support/
// commands.ts), so the first test is a Spanish browser following an English
// link, which is what a clinic sending ?lang=en to a patient looks like.

const browserIn = (tags: string[]) => ({
  headers: { 'Accept-Language': tags.join(',') },
  onBeforeLoad: (win: Window) => Object.defineProperty(win.navigator, 'languages', { value: tags, configurable: true }),
})

function bookableClinic() {
  return cy.seedStaffAccount().then((account) => {
    cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
    cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Consultation', durationMinutes: 30, onlineBookingEnabled: true })
    return cy.wrap(account)
  })
}

function selectBookableDayWithSlots(noTimes: string, loadingTimes: string, attempt = 0) {
  cy.get('.grid.grid-cols-7 button:not([disabled])').eq(attempt).click()
  cy.contains(loadingTimes).should('not.exist')
  cy.get('body').then(($body) => {
    if ($body.text().includes(noTimes)) {
      if (attempt > 15) throw new Error('No bookable day within the visible range had available slots')
      selectBookableDayWithSlots(noTimes, loadingTimes, attempt + 1)
    }
  })
}

const patientByEmail = (accountId: string, email: string) =>
  cy.task<{ id: string; preferred_language: string }[]>('db:selectRows', { table: 'patients', columns: 'id, preferred_language', match: { account_id: accountId, email } })

describe('The booking page in the patient\'s language', () => {
  it('books in English from ?lang=en, and the new patient prefers English', () => {
    bookableClinic().then((account) => {
      const email = `ana.${Date.now()}@example.test`
      cy.visit(`/book/${account.accountSlug}?lang=en`)
      cy.get('html').should('have.attr', 'lang', 'en')
      cy.contains('h1', 'Book an appointment').should('be.visible')
      cy.contains('Choose your date and time').should('be.visible')
      cy.contains('Step 2 of 3').should('be.visible')
      cy.contains('Booking summary').should('be.visible')
      cy.contains('Elija su fecha y hora').should('not.exist')
      cy.get('[data-cy=booking-language-en]').should('have.attr', 'aria-pressed', 'true')

      selectBookableDayWithSlots('No times available that day.', 'Loading times')
      cy.contains('button', /^\d{2}:\d{2}$/).first().click()
      cy.contains('Enter your details').should('be.visible')
      cy.contains('label', 'First name *').parent().find('input').type('Ana')
      cy.contains('label', 'Last name').parent().find('input').type('Smith')
      cy.contains('label', 'Email *').parent().find('input').type(email)
      cy.contains('label', 'Mobile number *').parent().find('input[type="tel"]').type('600111002')
      cy.contains('button', 'Book appointment').click()
      cy.contains('Appointment booked!', { timeout: 15000 }).should('be.visible')
      cy.contains('¡Cita reservada!').should('not.exist')

      // book.post.ts records it before it answers, so it is there already.
      patientByEmail(account.accountId, email).then((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]!.preferred_language).to.eq('en')
      })
    })
  })

  it('follows an English browser with no ?lang, and switches to French on request', () => {
    bookableClinic().then((account) => {
      cy.visit(`/book/${account.accountSlug}`, browserIn(['en-GB', 'en']))
      cy.contains('Choose your date and time').should('be.visible')
      cy.get('[data-cy=booking-language-fr]').should('not.be.disabled').click()
      cy.contains('Choisissez la date et l’heure').should('be.visible')
      cy.contains('Étape 2 sur 3').should('be.visible')
      cy.get('html').should('have.attr', 'lang', 'fr')
      // Kept in the address, so a reload stays in French.
      cy.location('search').should('contain', 'lang=fr')
      cy.reload()
      cy.contains('Choisissez la date et l’heure').should('be.visible')
    })
  })

  it('leaves an existing patient\'s language as the desk set it', () => {
    bookableClinic().then((account) => {
      const email = `paco.${Date.now()}@example.test`
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paco', lastName: 'Ruiz', email, phone: '+34600111003' })
      cy.visit(`/book/${account.accountSlug}?lang=fr`)
      cy.contains('Choisissez la date et l’heure').should('be.visible')
      selectBookableDayWithSlots('Aucun horaire disponible ce jour-là.', 'Chargement des horaires')
      cy.contains('button', /^\d{2}:\d{2}$/).first().click()
      cy.contains('label', 'Prénom *').parent().find('input').type('Paco')
      cy.contains('label', 'E-mail *').parent().find('input').type(email)
      cy.contains('label', 'Numéro de portable *').parent().find('input[type="tel"]').type('600111003')
      cy.contains('button', 'Réserver').click()
      cy.contains('Rendez-vous réservé !', { timeout: 15000 }).should('be.visible')

      patientByEmail(account.accountId, email).then((rows) => {
        expect(rows, 'booked onto the existing record').to.have.length(1)
        expect(rows[0]!.preferred_language).to.eq('es')
      })
    })
  })
})
