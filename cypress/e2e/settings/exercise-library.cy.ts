// Settings > Exercise Library: the clinic's home exercises, edited in one
// place. Counts say who is doing each now; anything a patient has ever had
// is archived rather than deleted, because deleting the library row would
// cascade to their assignment and its ticked days.

describe('Exercise library', () => {
  it('adds, edits, counts, archives and only deletes what was never assigned', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Eva', lastName: 'Soler' }).then((patient) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Hugo', lastName: 'Ruiz' }).then((past) => {
          cy.task<{ id: string }[]>('db:insertRows', {
            table: 'exercises',
            rows: [
              { account_id: account.accountId, name: 'Puente de glúteo' },
              { account_id: account.accountId, name: 'Rotación torácica' },
            ],
          }).then(([bridge, rotation]) => {
            cy.task('db:insertRows', {
              table: 'patient_exercises',
              rows: [
                { account_id: account.accountId, patient_id: patient.id, exercise_id: bridge.id },
                // Stopped: counts as "ever", not "now".
                { account_id: account.accountId, patient_id: past.id, exercise_id: rotation.id, ended_at: new Date().toISOString() },
              ],
            })
          })
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/settings/exercises')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.contains('[data-cy="library-row"]', 'Puente de glúteo').find('[data-cy="library-row-count"]').should('have.text', '1 patient')
      cy.contains('[data-cy="library-row"]', 'Rotación torácica').find('[data-cy="library-row-count"]').should('have.text', 'Nobody now')

      // Add one.
      cy.get('[data-cy="library-new"]').click()
      cy.get('[data-cy="library-name"]').type('Plancha lateral')
      cy.get('[data-cy="library-link"]').type('not a link')
      cy.get('[data-cy="library-save"]').click()
      cy.get('[data-cy="library-form"]').should('contain', 'https://')
      cy.get('[data-cy="library-link"]').clear().type('https://example.com/plancha')
      cy.get('[data-cy="library-save"]').click()
      cy.contains('[data-cy="library-row"]', 'Plancha lateral').should('contain', 'Never assigned').and('contain', 'https://example.com/plancha')

      // Edit one: the change is on the library row every patient points at.
      cy.contains('[data-cy="library-row"]', 'Puente de glúteo').find('[data-cy="library-edit"]').click()
      cy.get('[data-cy="library-instructions"]').type('Sube la cadera y aguanta 3 segundos.')
      cy.get('[data-cy="library-save"]').click()
      cy.contains('[data-cy="library-row"]', 'Puente de glúteo').should('contain', 'Sube la cadera')

      // Archive both unused and once-used: only the never-assigned one can be deleted.
      cy.contains('[data-cy="library-row"]', 'Plancha lateral').find('[data-cy="library-archive"]').click()
      cy.contains('[data-cy="library-row"]', 'Rotación torácica').find('[data-cy="library-archive"]').click()
      cy.contains('[data-cy="library-archived-row"]', 'Rotación torácica').find('[data-cy="library-delete"]').should('not.exist')
      cy.contains('[data-cy="library-archived-row"]', 'Plancha lateral').find('[data-cy="library-delete"]').click()
      cy.contains('[data-cy="library-archived-row"]', 'Plancha lateral').should('not.exist')

      // Restore brings it back to the picker's list.
      cy.contains('[data-cy="library-archived-row"]', 'Rotación torácica').find('[data-cy="library-restore"]').click()
      cy.contains('[data-cy="library-row"]', 'Rotación torácica').should('exist')
      cy.get('[data-cy="library-archived"]').should('not.exist')
    })
  })
})
