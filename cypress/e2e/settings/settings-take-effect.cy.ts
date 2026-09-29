// Each settings page is tested on its own; these follow a setting from the
// page where it is changed to the place it takes effect. That is the half a
// settings spec cannot see: the Online Booking text override that saved
// happily under a key the booking page never read was exactly this gap.

describe('Settings take effect where they are used', () => {
  it('Online Booking texts appear on the public booking page', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:enableOnlineBooking', { clinicId: account.clinicId })
      cy.task('db:createAppointmentType', { accountId: account.accountId, name: 'Ajuste', durationMinutes: 30, onlineBookingEnabled: true })
      // A second bookable practitioner, so the page asks the patient to choose
      // one -- the step whose heading was the broken override.
      cy.setExtraProfessionals(account.accountId, 3).then(() =>
        cy.task('db:createTeamMemberWithRole', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          roleName: 'Practitioner',
          email: `second-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`,
          password: 'Test1234!',
          fullName: 'Segunda Fisio',
          isPractitioner: true,
        }),
      )

      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/online-booking')
      cy.get('[data-cy="booking-settings"][data-ready="true"]')
      cy.get('[data-text-key="heading"] input').type('Pide tu cita')
      cy.get('[data-text-key="select_heading"] input').type('¿Con quién quieres venir?')
      cy.get('[data-text-key="any_practitioner_label"] input').type('Primer hueco libre')
      cy.get('[data-cy="booking-save"]').click()
      cy.wait('@saveAccount')

      cy.visit(`/book/${account.accountSlug}`)
      cy.contains('h1', 'Pide tu cita').should('be.visible')
      cy.contains('¿Con quién quieres venir?').should('be.visible')
      cy.contains('Primer hueco libre').should('be.visible')
      cy.contains('Elija un profesional').should('not.exist')
    })
  })

  it('a saved reply is offered in the Inbox composer', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Respuesta' }).then((patient: any) => {
        cy.task('db:createWhatsappMessage', { accountId: account.accountId, patientId: patient.id, phoneNumber: '+34600000071', direction: 'inbound', bodyPreview: '¿A qué hora abrís?' })
      })
      cy.login(account.email, account.password)
      cy.visit('/settings/saved-replies')
      cy.get('[data-cy="replies-settings"][data-ready="true"]')
      cy.get('[data-cy="reply-new"]').click()
      cy.get('[data-cy="reply-title"]').clear().type('Horario')
      cy.get('[data-cy="reply-body"]').type('Abrimos de 9 a 20.')
      cy.get('[data-cy="reply-save"]').click()
      cy.get('[data-cy="reply-save"]').should('be.disabled')

      cy.visit('/inbox')
      cy.contains('Rita Respuesta').click()
      cy.get('textarea[placeholder="Type a message…"]').should('be.visible')
      // force: under `nuxt dev` the DevTools launcher floats over the bottom
      // of the composer; the production build CI runs has no such overlay.
      cy.get('button[title="Saved replies"]').click({ force: true })
      cy.contains('button', 'Horario').click()
      cy.get('textarea[placeholder="Type a message…"]').should('have.value', 'Abrimos de 9 a 20.')
    })
  })

  it('a form sent from a patient’s record is counted in Docs', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createDocTemplate', { accountId: account.accountId, title: 'Consentimiento informado', category: 'consent' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dora', lastName: 'Docs' }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit('/settings/docs')
        cy.get('[data-cy="docs-settings"][data-ready="true"]')
        cy.contains('[data-cy="doc-row"]', 'Consentimiento informado').find('[data-cy="doc-counts"]').should('have.text', 'Not sent yet')

        cy.visit(`/patients/${patient.id}?tab=attachments`)
        cy.contains('button', 'Send a form').click()
        cy.contains('button', 'Consentimiento informado').click()
        cy.visit('/settings/docs')
        cy.get('[data-cy="docs-settings"][data-ready="true"]')
        cy.contains('[data-cy="doc-row"]', 'Consentimiento informado').find('[data-cy="doc-counts"]').should('have.text', '1 sent · 0 completed')
      })
    })
  })

  it('new-lead alerts saved in Leads are what a new lead notifies', () => {
    // The alert fields moved from Communication > General to Leads; the
    // notifier (server/utils/leadNotifications) reads the same columns.
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/leads')
      cy.get('[data-cy="leads-settings"][data-ready="true"]')
      cy.get('[data-cy="lead-notify-email"]').type('avisos@example.test')
      cy.get('[data-test="save-lead-settings"]').click()
      cy.wait('@saveAccount')

      // And Messages, where they used to be, neither shows nor clears them.
      cy.visit('/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')
      cy.get('[data-cy="messages-save"]').click()
      cy.wait('@saveAccount')
      cy.task<{ new_lead_notify_email: string }>('db:commsSettingsOf', { accountId: account.accountId }).its('new_lead_notify_email').should('eq', 'avisos@example.test')
    })
  })
})
