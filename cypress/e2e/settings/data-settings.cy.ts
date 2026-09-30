// Settings > Data and Developers after the redesign: Import says how far each
// step got, Files takes over Migrate Attachments and Compress Files, and
// Webhooks moves under Developers beside API & Tokens.

describe('Data and developer settings', () => {
  it('lists Import and Files under Data, Webhooks under Developers, and sends the old pages to Files', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/files')
      cy.get('[data-cy="files-settings"][data-ready="true"]')
      cy.get('nav').contains('a', 'Import').should('have.attr', 'href', '/settings/import')
      cy.get('nav').contains('a', 'Webhooks').should('have.attr', 'href', '/settings/webhooks')
      cy.get('nav').contains('a', 'Migrate Attachments').should('not.exist')
      cy.get('nav').contains('a', 'Compress Files').should('not.exist')

      for (const old of ['/settings/migrate-attachments', '/settings/compress-files']) {
        cy.visit(old)
        cy.location('pathname').should('eq', '/settings/files')
      }
    })
  })

  it('counts the files that came across without content, and links to the importer that fetches them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pedro', lastName: 'Sanz' }).then((p) => {
        const base = { accountId: account.accountId, patientId: p.id }
        cy.task('db:createPatientFile', { ...base, fileName: 'Radiografia.pdf', storagePath: null, externalReference: '4411' })
        cy.task('db:createPatientFile', { ...base, fileName: 'Informe.pdf' })
        cy.task('db:createPatientFile', { ...base, fileName: 'Consentimiento.pdf', compressed: true })
      })
      cy.login(account.email, account.password)
      cy.visit('/settings/files')
      cy.get('[data-cy="files-settings"][data-ready="true"]')

      cy.get('[data-cy="files-total"]').should('have.text', '3')
      cy.get('[data-cy="files-missing"]').should('have.text', '1')
      cy.get('[data-cy="files-uncompressed"]').should('have.text', '1')
      cy.get('[data-cy="files-compress-progress"]').should('have.text', '1 of 2 compressed')
      cy.get('[data-cy="files-compress-start"]').should('have.text', 'Compress 1 file').and('not.be.disabled')

      cy.get('[data-cy="files-missing-card"]').within(() => {
        cy.contains('h2', '1 file came across without its content')
        cy.contains('summary', 'Which ones').click()
        cy.contains('li', 'Radiografia.pdf · Pedro Sanz')
      })
      cy.get('[data-cy="files-fetch"]').click()
      cy.location('pathname').should('eq', '/settings/import')
      cy.get('[data-cy="import-step"][aria-current="step"]').should('have.attr', 'data-step', 'file_attachments')
      cy.get('[data-cy="import-panel"] h2').should('have.text', 'Files')
    })
  })

  it('says under each import step how many records it has brought across', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', externalReference: 'PH-100' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Luis', externalReference: 'PH-101' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Typed by hand' })
      cy.login(account.email, account.password)
      cy.visit('/settings/import?type=not-a-step')
      cy.get('[data-cy="import-settings"][data-ready="true"]')

      // An address naming no step opens the first one rather than a blank panel.
      cy.get('[data-cy="import-panel"] h2').should('have.text', 'Connection')
      cy.get('[data-step="patients"] [data-cy="import-step-status"]').should('have.text', '2 imported')
      cy.get('[data-step="appointments"] [data-cy="import-step-status"]').should('have.text', 'Not run yet')
      cy.get('[data-step="reconciliation"] [data-cy="import-step-status"]').should('not.exist')

      cy.get('[data-cy="import-source-other"]').click()
      cy.get('[data-cy="import-source-other"]').should('have.attr', 'aria-checked', 'true')
      cy.location('search').should('include', 'source=other')
      cy.get('[data-cy="import-panel"] input[type=file]').should('exist')
    })
  })

  it('makes a token in a side panel, shows it once, and revokes it through a dialog', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/developers')
      cy.get('[data-cy="developers-settings"][data-ready="true"]')

      cy.get('[data-cy="token-new"]').click()
      cy.get('[data-cy="token-panel"]').within(() => {
        cy.get('[data-cy="token-name"]').should('have.focus').type('Booking widget')
        cy.get('[data-cy="token-create"]').click()
        cy.get('[data-cy="token-error"]').should('contain', 'at least one')
        cy.get('[data-cy="token-scope"][value="appointments:read"]').check()
        cy.get('[data-cy="token-create"]').click()
      })
      cy.get('[data-cy="token-panel"]').should('not.exist')
      cy.get('[data-cy="token-raw"]').invoke('text').should('match', /^qf_live_[0-9a-f]{48}$/)
      cy.contains('[data-cy="token-row"]', 'Booking widget').should('contain', 'appointments:read').and('contain', 'Never')

      cy.contains('[data-cy="token-row"]', 'Booking widget').find('[data-cy="token-revoke"]').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Revoke token').click()
      cy.get('[data-cy="token-row"]').should('not.exist')
    })
  })

  it('adds an endpoint, logs what the database sends it, and deletes it through a dialog', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/webhooks')
      cy.get('[data-cy="webhooks-settings"][data-ready="true"]')
      cy.get('[data-cy="webhooks-empty"]')

      cy.get('[data-cy="webhook-new"]').click()
      cy.get('[data-cy="webhook-url"]').should('have.focus').type('http://insecure.example.test/hook')
      cy.get('[data-event="appointment.created"]').check()
      cy.get('[data-cy="webhook-save"]').click()
      // Patient data goes out in the body; plain http is refused.
      cy.get('[data-cy="webhook-error"]').should('contain', 'https://')
      cy.get('[data-cy="webhook-url"]').clear().type('https://hooks.example.test/quiroflow')
      cy.get('[data-cy="webhook-save"]').click()
      cy.contains('[data-cy="webhook-card"]', 'https://hooks.example.test/quiroflow').should('contain', 'Appointments · created')

      // The trigger writes a delivery row whatever the far end answers.
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta' }).then((p) => {
        cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, startsAt: new Date(Date.now() + 86400000).toISOString() })
      })
      cy.get('[data-cy="webhook-log-toggle"]').click()
      cy.get('[data-cy="webhook-log"]').should('contain', 'appointment.created')

      cy.get('[data-cy="webhook-enabled"]').click().should('have.attr', 'aria-checked', 'false')
      cy.reload()
      cy.get('[data-cy="webhooks-settings"][data-ready="true"]')
      cy.get('[data-cy="webhook-enabled"]').should('have.attr', 'aria-checked', 'false')

      cy.get('[data-cy="webhook-delete"]').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Delete endpoint').click()
      cy.get('[data-cy="webhooks-empty"]')
    })
  })

  it('keeps Webhooks for whoever can see API & Tokens, not whoever can import', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { settings_access: true, data_admin: true, developers_access: false } })
      const email = `datanodev-${Date.now()}@example.test`
      const password = 'Test1234!'
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password, fullName: 'Data Sin Dev' }).then(() => {
        cy.login(email, password)
        cy.visit('/settings/files')
        cy.get('[data-cy="files-settings"][data-ready="true"]')
        cy.get('nav').contains('a', 'Webhooks').should('not.exist')
        cy.visit('/settings/webhooks')
        cy.location('pathname', { timeout: 20000 }).should('eq', '/dashboard')
      })
    })
  })
})
