// Exercise programmes: built in Settings > Exercise Library, assigned whole
// from a patient's record (skipping what the patient already has), and made
// from what a patient has via "Save as programme". A programme is a template:
// assigning copies its items, so deleting it leaves the patient's exercises.

describe('Exercise programmes', () => {
  it('is built in Settings, assigned whole on the record, and deleting it keeps what patients have', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'exercises',
        rows: [
          { account_id: account.accountId, name: 'Puente de glúteo' },
          { account_id: account.accountId, name: 'Gato-camello' },
          { account_id: account.accountId, name: 'Plancha lateral' },
        ],
      }).then(([bridge]) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Casas' }).then((patient) => {
          // Already has one of the programme's exercises.
          cy.task('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: account.accountId, patient_id: patient.id, exercise_id: bridge.id, sets: 2, reps: '8' }] })

          cy.login(account.email, account.password)
          cy.visit('/settings/exercises')
          cy.get('[data-cy="settings-list"][data-ready="true"]')

          cy.get('[data-cy="program-new"]').click()
          cy.get('[data-cy="program-name"]').type('Lumbalgia básica')
          cy.get('[data-cy="program-item"]').eq(0).within(() => {
            cy.get('[data-cy="program-item-exercise"]').select('Puente de glúteo')
            cy.get('[data-cy="program-item-sets"]').type('3')
            cy.get('[data-cy="program-item-reps"]').type('12')
          })
          cy.get('[data-cy="program-item-add"]').click()
          cy.get('[data-cy="program-item"]').eq(1).within(() => {
            cy.get('[data-cy="program-item-exercise"]').select('Gato-camello')
            cy.get('[data-cy="program-item-reps"]').type('10')
            cy.get('[data-cy="program-item-frequency"]').type('2 veces al día')
          })
          cy.get('[data-cy="program-save"]').click()
          cy.contains('[data-cy="program-row"]', 'Lumbalgia básica').should('contain', '2 exercises').and('contain', '3 × 12').and('contain', '2 veces al día')

          // In a programme, so the library will not offer to delete it even archived.
          cy.contains('[data-cy="library-row"]', 'Gato-camello').find('[data-cy="library-archive"]').click()
          cy.contains('[data-cy="library-archived-row"]', 'Gato-camello').find('[data-cy="library-delete"]').should('not.exist')
          cy.contains('[data-cy="program-row"]', 'Lumbalgia básica').should('contain', 'archived')
          cy.contains('[data-cy="library-archived-row"]', 'Gato-camello').find('[data-cy="library-restore"]').click()

          // On the record: one is new, the other they already have.
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy="exercise-row"]').should('have.length', 1)
          cy.get('[data-cy="exercises-assign-open"]').click()
          cy.get('[data-cy="exercise-pick"] option').contains('Lumbalgia básica (2)').then((o) => {
            cy.get('[data-cy="exercise-pick"]').select(o.val() as string)
          })
          cy.get('[data-cy="exercise-program-preview"]').should('contain', 'Gato-camello').and('contain', '10 · 2 veces al día')
          cy.get('[data-cy="exercise-sets"]').should('not.exist')
          cy.get('[data-cy="exercise-save"]').should('contain', 'Assign 2').click()
          cy.get('[data-cy="exercises-notice"]').should('contain', 'Added 1; 1 they already had.')
          cy.get('[data-cy="exercise-row"]').should('have.length', 2)
          // The existing one keeps its own dose; the new one takes the programme's.
          cy.contains('[data-cy="exercise-row"]', 'Puente de glúteo').should('contain', '2 × 8')
          cy.contains('[data-cy="exercise-row"]', 'Gato-camello').should('contain', '10 · 2 veces al día')

          // Deleting the programme leaves the patient's exercises alone.
          cy.visit('/settings/exercises')
          cy.contains('[data-cy="program-row"]', 'Lumbalgia básica').find('[data-cy="program-delete"]').click()
          cy.get('[data-cy="confirm-dialog"]').contains('button', 'Delete programme').click()
          cy.get('[data-cy="program-row"]').should('not.exist')
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy="exercise-row"]').should('have.length', 2)
        })
      })
    })
  })

  it("saves a patient's exercises as a programme from the record", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'exercises',
        rows: [
          { account_id: account.accountId, name: 'Rotación torácica' },
          { account_id: account.accountId, name: 'Bird-dog' },
        ],
      }).then(([rotation, birdDog]) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marcos', lastName: 'Peña' }).then((patient) => {
          cy.task('db:insertRows', {
            table: 'patient_exercises',
            rows: [
              { account_id: account.accountId, patient_id: patient.id, exercise_id: rotation.id, sets: 2, reps: '10' },
              { account_id: account.accountId, patient_id: patient.id, exercise_id: birdDog.id, reps: '30 s', frequency: 'diario' },
            ],
          })
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy="exercise-row"]').should('have.length', 2)
          cy.get('[data-cy="exercises-save-as-program"]').click()
          cy.get('[data-cy="exercises-program-save"]').click()
          cy.get('[data-cy="staff-exercises"]').should('contain', 'Give the programme a name.')
          cy.get('[data-cy="exercises-program-name"]').type('Dorsal')
          cy.get('[data-cy="exercises-program-save"]').click()
          cy.get('[data-cy="exercises-notice"]').should('contain', 'Saved as “Dorsal”.')

          cy.visit('/settings/exercises')
          cy.contains('[data-cy="program-row"]', 'Dorsal').should('contain', '2 exercises').and('contain', '2 × 10').and('contain', '30 s · diario')
        })
      })
    })
  })

  it("will not create or overwrite another clinic's programme", () => {
    cy.seedStaffAccount().then((other) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: other.accountId, name: 'Ajeno' }] }).then(([program]) => {
        cy.seedStaffAccount().then((mine) => {
          const as = { email: mine.email, password: mine.password, fn: 'save_exercise_program' }
          // Overwriting: RLS hides the row from the update, so nothing is found.
          cy.task<{ error: string | null }>('db:rpcAsStaff', { ...as, args: { p_account_id: mine.accountId, p_program_id: program.id, p_name: 'Mío', p_description: null, p_items: [] } })
            .its('error').should('match', /not found/i)
          // Creating one in their account: refused by the insert policy.
          cy.task<{ error: string | null }>('db:rpcAsStaff', { ...as, args: { p_account_id: other.accountId, p_program_id: null, p_name: 'Mío', p_description: null, p_items: [] } })
            .its('error').should('match', /row-level security/i)
          cy.task<{ name: string }[]>('db:selectRows', { table: 'exercise_programs', columns: 'name', match: { account_id: other.accountId } }).then((rows) => {
            expect(rows.map((r) => r.name)).to.deep.eq(['Ajeno'])
          })
        })
      })
    })
  })
})
