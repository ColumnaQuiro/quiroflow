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
