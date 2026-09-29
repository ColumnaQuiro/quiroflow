// Settings > Messages (was Communication > General), Saved Replies, Docs and
// Leads, redesigned together; the new-lead alerts moved from Messages to Leads.

describe('Communication settings', () => {
  it('renames General to Messages, and keeps the old address working', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/communications-general')
      cy.location('pathname').should('eq', '/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')
      cy.get('nav').contains('a', 'Messages').should('have.attr', 'href', '/settings/messages')
      // The alerts are not here any more, and the page says where they went.
      cy.contains('Notify WhatsApp number').should('not.exist')
      cy.get('[data-cy="messages-leads-link"]').should('have.attr', 'href', '/settings/leads')
    })
  })

  it('shows the email only for a channel that sends one, and previews it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/messages')
      cy.get('[data-cy="messages-settings"][data-ready="true"]')

      cy.get('[data-cy="messages-confirmation"]').within(() => {
        cy.get('[data-cy="channel-email"]').then(($b) => {
          if ($b.attr('aria-pressed') !== 'true') cy.wrap($b).click()
        })
        cy.get('[data-cy="email-subject"]').clear().type('Hola {{first_name}}', { parseSpecialCharSequences: false })
        cy.get('[data-cy="email-preview"]').should('contain', 'Hola Lucía')
      })
      cy.get('[data-cy="messages-save"]').click()
      cy.wait('@saveAccount').its('request.body').should((body) => {
        expect(body.email_confirmation_subject).to.eq('Hola {{first_name}}')
        expect(body.appointment_confirmation_channels).to.include('email')
        expect(body).not.to.have.property('new_lead_notify_email')
      })

      cy.get('[data-cy="messages-confirmation"] [data-cy="channel-email"]').click()
      cy.get('[data-cy="messages-confirmation"] [data-cy="email-subject"]').should('not.exist')
    })
  })

  it('keeps the new-lead alerts in Leads now', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/leads')
      cy.get('[data-cy="leads-settings"][data-ready="true"]')

      cy.get('[data-cy="lead-stages"] [data-stage="booked"]').should('contain', 'Automatic')
      cy.get('[data-cy="lead-notify-email"]').type('recepcion@example.test')
      cy.get('[data-cy="lead-notify-whatsapp"]').type('+34600111222')
      cy.get('[data-test="save-lead-settings"]').click()
      cy.wait('@saveAccount')
      cy.task<{ new_lead_notify_email: string; new_lead_notify_whatsapp: string }>('db:commsSettingsOf', { accountId: account.accountId }).then((row) => {
        expect(row.new_lead_notify_email).to.eq('recepcion@example.test')
        expect(row.new_lead_notify_whatsapp).to.eq('+34600111222')
      })
    })
  })

  it('edits saved replies side by side, and saves the open one before switching', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/saved-replies')
      cy.get('[data-cy="replies-settings"][data-ready="true"]')

      cy.get('[data-cy="reply-new"]').click()
      cy.get('[data-cy="reply-title"]').clear().type('Horario')
      cy.get('[data-cy="reply-body"]').type('Abrimos de 9 a 20.')
      cy.get('[data-cy="reply-save"]').click()
      cy.contains('[data-cy="reply-row"]', 'Horario').should('be.visible')

      cy.get('[data-cy="reply-new"]').click()
      cy.get('[data-cy="reply-title"]').clear().type('Parking')
      // Switching away saves it rather than dropping the typing.
      cy.contains('[data-cy="reply-row"]', 'Horario').click()
      cy.contains('[data-cy="reply-row"]', 'Parking').should('be.visible')
      cy.get('[data-cy="reply-body"]').should('have.value', 'Abrimos de 9 a 20.')

      cy.get('[data-cy="reply-delete"]').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Delete reply').click()
      cy.contains('[data-cy="reply-row"]', 'Horario').should('not.exist')
    })
  })

  it('says how many patients each document template reached', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createDocTemplate', { accountId: account.accountId, title: 'Consentimiento', category: 'consent' }).then((tpl) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p: any) => {
          cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: p.id, title: 'Consentimiento', templateId: tpl.id, completed: true })
          cy.task('db:createPatientDoc', { accountId: account.accountId, patientId: p.id, title: 'Consentimiento', templateId: tpl.id })
        })
      })
      cy.login(account.email, account.password)
      cy.visit('/settings/docs')
      cy.get('[data-cy="docs-settings"][data-ready="true"]')
      cy.contains('[data-cy="doc-row"]', 'Consentimiento').find('[data-cy="doc-counts"]').should('have.text', '2 sent · 1 completed')
    })
  })
})
