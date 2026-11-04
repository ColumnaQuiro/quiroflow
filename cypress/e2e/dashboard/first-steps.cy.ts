// First steps on the Dashboard (DashboardFirstSteps): what a clinic that has
// just signed up sees above its widgets -- add an appointment type, a patient,
// and book that patient's first visit. Each step is read from the clinic's own
// data, so it ticks however the thing got done; these specs do the work
// through db tasks and only check what the card makes of it.
describe('Dashboard first steps', () => {
  it('walks a new owner to the first booked visit, then gets out of the way', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps]', { timeout: 20000 }).should('contain', 'Your first visit, three steps away')
      cy.get('[data-cy=first-steps-type]').should('have.attr', 'aria-current', 'step').and('have.attr', 'data-done', 'false')
      cy.get('[data-cy=first-steps-patient]').should('have.attr', 'data-done', 'false')
      cy.get('[data-cy=first-steps-visit]').should('have.attr', 'data-done', 'false')

      // The step's button opens the form itself, not an empty list.
      cy.get('[data-cy=first-steps-type]').contains('a', 'Add a type').click()
      cy.contains('New appointment type', { timeout: 20000 }).should('be.visible')
      cy.location('search').should('eq', '')

      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita', durationMinutes: 45, defaultPriceCents: 4000 })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: 'Prueba' }).then((patient) => {
        cy.visit('/dashboard')
        cy.get('[data-cy=first-steps-type]', { timeout: 20000 }).should('have.attr', 'data-done', 'true')
        cy.get('[data-cy=first-steps-patient]').should('have.attr', 'data-done', 'true')
        // Booking starts with the patient just added already chosen.
        cy.get('[data-cy=first-steps-visit]')
          .should('have.attr', 'aria-current', 'step')
          .contains('a', 'Open the calendar')
          .should('have.attr', 'href', `/calendar?patient=${patient.id}`)

        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() })
      })

      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps][data-complete=true]', { timeout: 20000 }).should('contain', 'Your first visit is booked')
      cy.get('[data-cy=first-steps-dismiss]').click()
      cy.get('[data-cy=first-steps]').should('not.exist')

      // Dismissed stays dismissed.
      cy.reload()
      cy.get('[data-cy=first-steps-root][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=first-steps]').should('not.exist')
    })
  })

  // Onboarding's Import step names a source; the card then leads with the
  // import, and once it has brought visits under names from the old software,
  // asks for those names to be linked to the team.
  it('leads with the import a new clinic asked for, then the practitioners it left unlinked', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.window().then((win) => win.localStorage.setItem(`first-steps-import:${account.accountId}`, 'practicehub'))
      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps-import]', { timeout: 20000 })
        .should('have.attr', 'aria-current', 'step')
        .and('contain', 'Bring your records from PracticeHub')
        .contains('a', 'Import')
        .should('have.attr', 'href', '/settings/import?source=practicehub')
      cy.get('[data-cy=first-steps-link]').should('not.exist')

      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Imported', lastName: 'Patient', externalReference: '1001' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: null, practitionerName: 'A. Esteve', startsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() })
      })
      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps-import]', { timeout: 20000 }).should('have.attr', 'data-done', 'true')
      cy.get('[data-cy=first-steps-link]')
        .should('have.attr', 'data-done', 'false')
        .and('contain', '1 visit is under a name from your old software')
        .contains('a', 'Link names')
        .should('have.attr', 'href', '/settings/team#importados')
    })
  })

  it('drops the optional import for a clinic starting fresh', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps-import]', { timeout: 20000 }).should('contain', 'Optional').and('not.have.attr', 'aria-current')
      cy.get('[data-cy=first-steps-import-alternative]').click()
      cy.get('[data-cy=first-steps-import]').should('not.exist')
      cy.reload()
      cy.get('[data-cy=first-steps-type]', { timeout: 20000 }).should('have.attr', 'aria-current', 'step')
      cy.get('[data-cy=first-steps-import]').should('not.exist')
    })
  })

  it('is never shown to a clinic that already has all three', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste' })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ya', lastName: 'Establecida' }).then((patient) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
      })
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=first-steps-root][data-ready=true]', { timeout: 20000 })
      // Not the "booked" acknowledgement either: this browser never saw a step open.
      cy.get('[data-cy=first-steps]').should('not.exist')
    })
  })

  it('is shown to the owner only', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `front-desk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: account.password, fullName: 'Recepción' })
      cy.login(email, account.password)
      cy.visit('/dashboard')
      cy.get('h1', { timeout: 20000 }).should('contain', 'Recepción')
      cy.get('[data-cy=first-steps-root]').should('not.exist')
    })
  })
})
