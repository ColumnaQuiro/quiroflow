// Bulk edits from the patient list: tag, practitioner, archive and reactivate
// a selection, or everyone the filters match (bulk_update_patients,
// 20261113143728_patients_bulk_edit.sql). Each runs as the person clicking,
// so a role's guards still apply row by row.
describe('Patient list bulk edits', () => {
  const state = (id: string) =>
    cy
      .task<{ status: string; default_practitioner_id: string | null; tags: string[] }[]>('db:selectRows', {
        table: 'patients',
        columns: 'status, default_practitioner_id, tags',
        match: { id },
      })
      .then((rows) => rows[0])

  it('tags, assigns, archives and reactivates the ticked patients', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', {
        ...base,
        roleName: 'Practitioner',
        email: `bulk-prac-${Date.now()}@example.test`,
        password: 'Test1234!',
        fullName: 'Dra. Lista',
      }).as('prac')
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Alba', lastName: 'Correo' }).as('alba')
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Bruno', lastName: 'Ambos' }).as('bruno')
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Carla', lastName: 'Ninguno' }).as('carla')
      cy.get<{ id: string }>('@bruno').then((b) => cy.task('db:setPatientTags', { patientId: b.id, tags: ['vip'] }))

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('3 patients', { timeout: 15000 }).should('be.visible')

      const tickAlbaAndBruno = () => {
        cy.contains('tr', 'Alba Correo').find('[data-cy=select-row]').check()
        cy.contains('tr', 'Bruno Ambos').find('[data-cy=select-row]').check()
        cy.get('[data-cy=bulk-count]').should('have.text', '2 selected')
      }

      // A tag, matched without regard to case: Bruno already has it.
      tickAlbaAndBruno()
      cy.get('[data-cy=bulk-tags]').click()
      cy.get('[data-cy=bulk-edit-tag-input]').type('VIP')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('Tag added to 1 patient · 1 already were').should('be.visible')
      cy.get('[data-cy=bulk-bar]').should('not.exist')
      cy.get<{ id: string }>('@alba').then((a) => state(a.id).its('tags').should('deep.equal', ['VIP']))
      cy.get<{ id: string }>('@bruno').then((b) => state(b.id).its('tags').should('deep.equal', ['vip']))
      cy.get<{ id: string }>('@carla').then((c) => state(c.id).its('tags').should('deep.equal', []))

      // A practitioner.
      tickAlbaAndBruno()
      cy.get('[data-cy=bulk-practitioner]').click()
      cy.get('[data-cy=bulk-edit-practitioner]').select('Dra. Lista')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('Practitioner changed for 2 patients').should('be.visible')
      cy.get<{ teamMemberId: string }>('@prac').then((prac) => {
        cy.get<{ id: string }>('@alba').then((a) => state(a.id).its('default_practitioner_id').should('eq', prac.teamMemberId))
        cy.get<{ id: string }>('@carla').then((c) => state(c.id).its('default_practitioner_id').should('eq', null))
      })

      // Archived: they leave the default list, and nothing else changes.
      tickAlbaAndBruno()
      cy.get('[data-cy=bulk-reactivate]').should('not.exist')
      cy.get('[data-cy=bulk-archive]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('2 patients archived').should('be.visible')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Alba Correo').should('not.exist')
      cy.get<{ id: string }>('@bruno').then((b) => state(b.id).its('status').should('eq', 'inactive'))
      cy.get<{ id: string }>('@carla').then((c) => state(c.id).its('status').should('eq', 'active'))

      // Found again by search, which reaches archived patients, and brought back.
      cy.get('input[type="search"]').type('Correo')
      cy.contains('tr', 'Alba Correo').find('[data-cy=select-row]').check()
      cy.get('[data-cy=bulk-reactivate]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('1 patient reactivated').should('be.visible')
      cy.get<{ id: string }>('@alba').then((a) => state(a.id).its('status').should('eq', 'active'))
      cy.get<{ id: string }>('@bruno').then((b) => state(b.id).its('status').should('eq', 'inactive'))
    })
  })

  it('archives everyone the filters match, past the page on screen', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 60 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fuera', lastName: 'Delfiltro' }).as('outside')
      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('61 patients', { timeout: 15000 }).should('be.visible')

      cy.get('input[type="search"]').type('Crowd')
      cy.contains('60 patients').should('be.visible')
      cy.get('[data-cy=select-page]').check()
      cy.get('[data-cy=bulk-select-all-matching]').click()
      cy.get('[data-cy=bulk-count]').should('have.text', '60 selected')
      cy.get('[data-cy=bulk-archive]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('60 patients archived').should('be.visible')

      cy.task<unknown[]>('db:selectRows', { table: 'patients', columns: 'id', match: { account_id: account.accountId, status: 'inactive' } }).should('have.length', 60)
      cy.get<{ id: string }>('@outside').then((o) => state(o.id).its('status').should('eq', 'active'))
    })
  })

  it('offers taking tags away only to a role that may remove them', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      const email = `bulk-desk-${Date.now()}@example.test`
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Front Desk', patch: { patients_tags_remove: false } })
      cy.task('db:createTeamMemberWithRole', { ...base, roleName: 'Front Desk', email, password: 'Test1234!', fullName: 'Recepción' })
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Dora', lastName: 'Socia' }).then((p) => {
        cy.task('db:setPatientTags', { patientId: p.id, tags: ['Mensual'] })

        cy.login(email, 'Test1234!')
        cy.visit('/patients')
        cy.contains('tr', 'Dora Socia', { timeout: 15000 }).find('[data-cy=select-row]').check()
        cy.get('[data-cy=bulk-tags]').click()
        cy.get('[data-cy=bulk-edit-tag-mode-remove]').should('not.exist')

        // Adding still works, picked from the clinic's tags or typed.
        cy.get('[data-cy=bulk-edit-tag-suggestion]').should('have.length', 1).and('have.text', 'Mensual')
        cy.get('[data-cy=bulk-edit-tag-input]').type('Seguimiento')
        cy.get('[data-cy=bulk-edit-tag-suggestion]').should('not.exist')
        cy.get('[data-cy=confirm-dialog-confirm]').click()
        cy.contains('Tag added to 1 patient').should('be.visible')
        state(p.id).its('tags').should('deep.equal', ['Mensual', 'Seguimiento'])
      })
    })
  })
})
