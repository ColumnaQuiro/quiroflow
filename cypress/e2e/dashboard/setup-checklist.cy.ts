// Puesta en marcha (/setup, useSetupChecklist): everything a new clinic sets
// up, each step read from the clinic's own data. These specs do the work
// through db tasks and check only what the list makes of it.
describe('Setup checklist', () => {
  it('ticks steps from the clinic data, and lets the optional ones be skipped', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/setup')
      cy.get('[data-cy=setup][data-ready=true]', { timeout: 20000 })

      // A fresh account: WhatsApp is not connected, so no reminder would go out.
      cy.get('[data-cy=setup-whatsapp]').should('have.attr', 'data-state', 'open').and('contain', 'none of them are sent')
      cy.get('[data-cy=setup-services]').should('have.attr', 'data-state', 'open')
      cy.get('[data-cy=setup-import]').should('have.attr', 'data-state', 'open')
      // The step to do now carries the primary button.
      cy.get('[aria-current=step]').should('have.length', 1)

      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Primera visita' })
      cy.task('db:setWhatsappPhoneNumberId', { accountId: account.accountId, phoneNumberId: '1234567890' })
      cy.task('db:updateRows', { table: 'accounts', values: { whatsapp_reminder_template_name: 'recordatorio_cita' }, match: { id: account.accountId } })
      // A patient typed in by hand is not a migration; an imported one is.
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'A', lastName: 'Mano' })

      cy.reload()
      cy.get('[data-cy=setup][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=setup-services]').should('have.attr', 'data-state', 'done')
      cy.get('[data-cy=setup-whatsapp]').should('have.attr', 'data-state', 'done')
      cy.get('[data-cy=setup-reminders]').should('have.attr', 'data-state', 'done')
      cy.get('[data-cy=setup-import]').should('have.attr', 'data-state', 'open')

      // Working alone: the team step is skipped, stays skipped, and can be undone.
      cy.get('[data-cy=setup-team-skip]').click()
      cy.get('[data-cy=setup-team]').should('have.attr', 'data-state', 'skipped')
      cy.reload()
      cy.get('[data-cy=setup-team]', { timeout: 20000 }).should('have.attr', 'data-state', 'skipped')
      cy.get('[data-cy=setup-team-unskip]').click()
      cy.get('[data-cy=setup-team]').should('have.attr', 'data-state', 'open')

      // A step that has to be done cannot be skipped.
      cy.get('[data-cy=setup-fiscal-skip]').should('not.exist')
    })
  })

  it('shows the owner where it stands from the dashboard', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/dashboard')
      cy.get('[data-cy=setup-progress]', { timeout: 20000 }).should('contain', 'Getting set up')
      cy.get('[data-cy=setup-progress-open]').click()
      cy.location('pathname').should('eq', '/setup')
    })
  })

  it('is the owner’s alone', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `front-desk-${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: account.password, fullName: 'Recepción' })
      cy.login(email, account.password)
      cy.visit('/dashboard')
      cy.get('h1', { timeout: 20000 }).should('contain', 'Recepción')
      cy.get('[data-cy=setup-progress]').should('not.exist')
      cy.visit('/setup')
      cy.location('pathname', { timeout: 20000 }).should('not.eq', '/setup')
    })
  })
})
