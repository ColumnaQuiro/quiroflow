// The front-desk check-in portal: Settings > Clínicas > a location > Portal de
// llegada makes a link; a tablet with no session opens it, a patient types
// their date of birth (DDMMAA) and is marked as arrived -- the same column the
// desk's "Mark as arrived" sets.
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

function typeBirthDate(digits: string) {
  for (const d of digits) cy.get(`[data-cy=check-in-portal-key-${d}]`).click()
}

// Turns the location's portal on and answers its link, then forgets the
// staff session: the tablet has none.
function portalLink(account: { email: string; password: string; clinicId: string }) {
  cy.login(account.email, account.password)
  cy.visit(`/settings/clinics/${account.clinicId}#llegada`)
  cy.get('[data-cy=clinic-check-in-portal][data-ready=true]')
  cy.get('[data-cy=clinic-check-in-portal-on]').click()
  return cy
    .get('[data-cy=clinic-check-in-portal-url]')
    .invoke('text')
    .should('match', /\/check-in\/[0-9a-f]{64}$/)
    .then((url) => {
      cy.clearAllCookies()
      cy.clearAllLocalStorage()
      return cy.wrap(new URL(url.trim()).pathname)
    })
}

describe('Check-in portal', () => {
  it('checks a patient in by date of birth, with no session on the tablet', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Tablet', dateOfBirth: '1985-03-07' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(20) }).then((appt) => {
          portalLink(account).then((path) => {
            cy.visit(path)
            cy.location('pathname').should('eq', path)
            cy.get('[data-cy=check-in-portal][data-phase=ready]')

            // A date that does not exist is refused on the tablet itself.
            typeBirthDate('310485')
            cy.get('[data-cy=check-in-portal-error]').should('contain.text', 'no existe')

            typeBirthDate('070385')
            cy.get('[data-cy=check-in-portal-done][data-status=checked_in]').should('contain.text', '¡Hola, Nora!')
            cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: appt.id }).its('checked_in_at').should('not.be.null')

            // The screen clears for the next patient; a second try says so.
            cy.get('[data-cy=check-in-portal-finish]').click()
            cy.get('[data-cy=check-in-portal-done]').should('not.exist')
            typeBirthDate('070385')
            cy.get('[data-cy=check-in-portal-done][data-status=already]').should('contain.text', 'Ya habías registrado')
          })
        })
      })
    })
  })

  it('asks which one when two patients share a birthday, and finds nobody for a visit hours away', () => {
    cy.seedStaffAccount().then((account) => {
      const make = (firstName: string, lastName: string, dateOfBirth: string, minutes: number) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName, dateOfBirth }).then((p) =>
          cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(minutes) }),
        )
      make('Ana', 'Gemela', '1990-06-12', 10)
      make('Bea', 'Gemela', '1990-06-12', 40).then((bea) => {
        make('Ciro', 'Tarde', '1975-01-02', 5 * 60).then((late) => {
          portalLink(account).then((path) => {
            cy.visit(path)
            typeBirthDate('120690')
            cy.get('[data-cy=check-in-portal-option]').should('have.length', 2).and('contain.text', 'A••• G.').and('contain.text', 'B••• G.')
            cy.get('[data-cy=check-in-portal-option]').contains('B••• G.').click()
            cy.get('[data-cy=check-in-portal-done][data-status=checked_in]').should('contain.text', '¡Hola, Bea!')
            cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: bea.id }).its('checked_in_at').should('not.be.null')

            cy.get('[data-cy=check-in-portal-finish]').click()
            typeBirthDate('020175')
            cy.get('[data-cy=check-in-portal-not-found]').should('be.visible')
            cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: late.id }).its('checked_in_at').should('be.null')
          })
        })
      })
    })
  })

  it('checks a patient in from the QR code in their app, read by a scanner', () => {
    const email = `checkin-qr-tablet-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Quim', lastName: 'Codigo' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(15) }).then((appt) => {
          portalLink(account).then((path) => {
            // The patient's app shows the code only because this location has a tablet.
            cy.intercept('GET', '/api/portal/appointments/check-in-code*').as('code')
            cy.login(email, password)
            cy.visit('/portal')
            cy.wait('@code').its('response.body.code').should('match', /^qfci\./).then((code) => {
              cy.get('[data-cy=patient-check-in-code-toggle]').click()
              cy.get('[data-cy=patient-check-in-code-qr]').should('be.visible').and('have.attr', 'src').and('match', /^data:image\/svg\+xml/)
              cy.clearAllCookies()
              cy.clearAllLocalStorage()

              // A USB scanner types the code and Enter, as a keyboard would.
              cy.visit(path)
              cy.get('[data-cy=check-in-portal][data-phase=ready]')
              cy.get('body').type(`${code}{enter}`, { delay: 0 })
              cy.get('[data-cy=check-in-portal-done][data-status=checked_in]').should('contain.text', 'Quim')
              cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: appt.id }).its('checked_in_at').should('not.be.null')

              // An edited code finds nobody.
              cy.get('[data-cy=check-in-portal-finish]').click()
              cy.get('body').type(`${String(code).slice(0, -2)}xx{enter}`, { delay: 0 })
              cy.get('[data-cy=check-in-portal-not-found]').should('be.visible')
            })
          })
        })
      })
    })
  })

  it('speaks the language chosen in Settings, with the clinic’s own messages, and a patient can switch', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lily', lastName: 'Visitor', dateOfBirth: '1992-11-23' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(25) })
        cy.login(account.email, account.password)
        cy.visit(`/settings/clinics/${account.clinicId}#llegada`)
        cy.get('[data-cy=clinic-check-in-portal][data-ready=true]')
        cy.get('[data-cy=clinic-check-in-portal-on]').click()
        cy.get('[data-cy=clinic-check-in-portal-language]').select('en')
        cy.get('[data-cy=clinic-check-in-portal-welcome]').type('Welcome to the demo clinic')
        cy.get('[data-cy=clinic-check-in-portal-success]').type('Please go straight to room 2')
        cy.intercept('PATCH', `/api/clinics/${account.clinicId}/check-in-portal`).as('save')
        cy.get('[data-cy=clinic-check-in-portal-save]').click()
        cy.wait('@save').its('response.statusCode').should('eq', 200)
        cy.get('[data-cy=clinic-check-in-portal-url]')
          .invoke('text')
          .then((url) => {
            cy.clearAllCookies()
            cy.clearAllLocalStorage()
            cy.visit(new URL(url.trim()).pathname)
          })

        cy.get('[data-cy=check-in-portal-welcome]').should('have.text', 'Welcome to the demo clinic')
        // In Spanish the clinic's English wording gives way to the standard text.
        cy.get('[data-cy=check-in-portal-lang-es]').click()
        cy.get('[data-cy=check-in-portal-welcome]').should('have.text', '¡Bienvenido! Registra tu llegada')
        cy.get('[data-cy=check-in-portal-lang-en]').click()
        typeBirthDate('231192')
        cy.get('[data-cy=check-in-portal-done-text]').should('contain.text', 'Please go straight to room 2')
        cy.get('[data-cy=check-in-portal-done]').should('contain.text', 'Hello, Lily!')

        // After a patient who switched to German, the tablet is back in English.
        cy.get('[data-cy=check-in-portal-finish]').click()
        cy.get('[data-cy=check-in-portal-lang-de]').click()
        cy.contains('Geben Sie Ihr Geburtsdatum ein')
        typeBirthDate('231192')
        cy.get('[data-cy=check-in-portal-done][data-status=already]').should('contain.text', 'Hallo, Lily!')
        cy.get('[data-cy=check-in-portal-finish]').click()
        cy.get('[data-cy=check-in-portal-welcome]').should('have.text', 'Welcome to the demo clinic')
      })
    })
  })

  it('identifies patients by DNI/NIE when the location chooses it, and then not by birthday', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dani', lastName: 'Documento', dateOfBirth: '1980-04-05', nationalId: '12.345.678-Z' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: minutesFromNow(30) }).then((appt) => {
          cy.login(account.email, account.password)
          cy.visit(`/settings/clinics/${account.clinicId}#llegada`)
          cy.get('[data-cy=clinic-check-in-portal][data-ready=true]')
          cy.get('[data-cy=clinic-check-in-portal-on]').click()
          cy.get('[data-cy=clinic-check-in-portal-identify-national_id]').click()
          cy.intercept('PATCH', `/api/clinics/${account.clinicId}/check-in-portal`).as('save')
          cy.get('[data-cy=clinic-check-in-portal-save]').click()
          cy.wait('@save').its('response.body.identifyBy').should('eq', 'national_id')
          cy.get('[data-cy=clinic-check-in-portal-url]')
            .invoke('text')
            .then((url) => {
              const path = new URL(url.trim()).pathname
              cy.clearAllCookies()
              cy.clearAllLocalStorage()

              // A birthday is no way in once the location asks for a DNI.
              cy.request({ method: 'POST', url: `/api/check-in-portal${path.slice('/check-in'.length)}`, body: { birthDate: '050480' }, failOnStatusCode: false }).its('status').should('eq', 400)

              cy.visit(path)
              cy.get('[data-cy=check-in-portal-date]').should('not.exist')
              cy.get('[data-cy=check-in-portal-national-id]').type('12345678z{enter}')
              cy.get('[data-cy=check-in-portal-done][data-status=checked_in]').should('contain.text', 'Dani')
              cy.task<{ checked_in_at: string | null }>('db:appointmentById', { appointmentId: appt.id }).its('checked_in_at').should('not.be.null')

              cy.get('[data-cy=check-in-portal-finish]').click()
              cy.get('[data-cy=check-in-portal-national-id]').type('87654321X')
              cy.get('[data-cy=check-in-portal-continue]').click()
              cy.get('[data-cy=check-in-portal-not-found]').should('be.visible')
            })
        })
      })
    })
  })

  it('stops working once turned off', () => {
    cy.seedStaffAccount().then((account) => {
      portalLink(account).then((path) => {
        cy.login(account.email, account.password)
        cy.visit(`/settings/clinics/${account.clinicId}#llegada`)
        cy.get('[data-cy=clinic-check-in-portal-off]').click()
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.get('[data-cy=clinic-check-in-portal-on]').should('be.visible')
        cy.visit(path)
        cy.get('[data-cy=check-in-portal-off]').should('be.visible')
      })
    })
  })
})
