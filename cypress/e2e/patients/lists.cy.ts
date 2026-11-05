// Patient lists: people put on a list by hand from a selection on the
// patient list, counted on the Lists tab with how many accept marketing, and
// opened as the patient list filtered to them (patient_lists,
// patient_list_members -- 20261105143740_patient_lists_and_audiences.sql).
//
// What the automation engine will read is checked too: audience_members and
// audience_entries_since name the same people the screen shows.
describe('Patient lists', () => {
  it('creates a list, adds a selection to it, opens it, takes one off and deletes it', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }
      const startedAt = new Date(Date.now() - 60_000).toISOString()
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Alba', lastName: 'Correo' }).then((p) => {
        cy.task('db:setPatientMarketing', { patientId: p.id, channels: ['email'] })
      })
      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Bruno', lastName: 'Ambos' }).then((p) => {
        cy.task('db:setPatientMarketing', { patientId: p.id, channels: ['email', 'whatsapp'] })
      })
      cy.task('db:createPatient', { ...base, firstName: 'Carla', lastName: 'Ninguno' })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('3 patients', { timeout: 15000 }).should('be.visible')

      // A list from the Lists tab.
      cy.get('[data-cy=audience-tab-lists]').click()
      cy.location('search').should('contain', 'view=lists')
      cy.get('[data-cy=list-create]').click()
      cy.get('[data-cy=segment-name]').type('Jornada abierta')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('[data-cy=list-row]', 'Jornada abierta').find('[data-cy=list-count]').should('have.text', '0')

      // Two people, ticked on the patient list and added to it.
      cy.get('[data-cy=audience-tab-patients]').click()
      cy.contains('tr', 'Alba Correo').find('[data-cy=select-row]').check()
      cy.contains('tr', 'Bruno Ambos').find('[data-cy=select-row]').check()
      cy.get('[data-cy=bulk-count]').should('have.text', '2 selected')
      cy.get('[data-cy=bulk-add-to-list]').click()
      cy.get('[data-cy=add-to-list-choice]').select('Jornada abierta')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('2 added to “Jornada abierta”').should('be.visible')
      cy.get('[data-cy=bulk-bar]').should('not.exist')

      // Counted, with consent per channel.
      cy.get('[data-cy=audience-tab-lists]').click()
      cy.contains('[data-cy=list-row]', 'Jornada abierta').within(() => {
        cy.get('[data-cy=list-count]').should('have.text', '2')
        cy.get('[data-cy=list-email-count]').should('have.text', '2')
        cy.get('[data-cy=list-whatsapp-count]').should('have.text', '1')
      })

      // Opened: the patient list, filtered to its members.
      cy.contains('[data-cy=list-row]', 'Jornada abierta').find('[data-cy=list-open]').click()
      cy.get('[data-cy=list-header]').should('contain', 'Jornada abierta')
      cy.contains('2 patients').should('be.visible')
      cy.contains('a', 'Alba Correo').should('be.visible')
      cy.contains('a', 'Carla Ninguno').should('not.exist')
      cy.location('search').should('contain', 'list=')

      // The automation feed agrees, and both came in after the spec started.
      cy.task<{ id: string } | null>('db:listByName', { accountId: account.accountId, name: 'Jornada abierta' }).then((list) => {
        cy.task('db:audience', { kind: 'list', id: list!.id }).should('deep.equal', ['Alba', 'Bruno'])
        cy.task('db:audience', { kind: 'list', id: list!.id, since: startedAt }).should('deep.equal', ['Alba', 'Bruno'])
        cy.task('db:listMembers', { listId: list!.id }).then((members: any) => {
          expect(members.map((m: any) => m.source)).to.deep.equal(['bulk', 'bulk'])
        })
      })

      // One taken off again, from the open list.
      cy.contains('tr', 'Bruno Ambos').find('[data-cy=select-row]').check()
      cy.get('[data-cy=bulk-remove-from-list]').click()
      cy.contains('1 removed from “Jornada abierta”').should('be.visible')
      cy.contains('1 patients').should('be.visible')
      cy.contains('a', 'Bruno Ambos').should('not.exist')

      // A reload opens the same list.
      cy.reload()
      cy.get('[data-cy=list-header]', { timeout: 15000 }).should('contain', 'Jornada abierta')
      cy.contains('1 patients').should('be.visible')

      // Deleted: the list goes, the patients stay.
      cy.get('[data-cy=list-delete]').click()
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('List deleted').should('be.visible')
      cy.get('[data-cy=list-header]').should('not.exist')
      cy.contains('3 patients').should('be.visible')
    })
  })

  it('adds everyone the filters match, past the page on screen, to a new list', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 60 })
      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('60 patients', { timeout: 15000 }).should('be.visible')

      cy.get('[data-cy=select-page]').check()
      cy.get('[data-cy=bulk-count]').should('have.text', '50 selected')
      cy.get('[data-cy=bulk-select-all-matching]').click()
      cy.get('[data-cy=bulk-count]').should('have.text', '60 selected')
      cy.get('[data-cy=bulk-add-to-list]').click()
      cy.get('[data-cy=add-to-list-choice]').select('New list…')
      cy.get('[data-cy=add-to-list-new-name]').type('Todos los de la ciudad')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
      cy.contains('60 added to “Todos los de la ciudad”').should('be.visible')

      cy.get('[data-cy=audience-tab-lists]').click()
      cy.contains('[data-cy=list-row]', 'Todos los de la ciudad').find('[data-cy=list-count]').should('have.text', '60')
    })
  })
})
