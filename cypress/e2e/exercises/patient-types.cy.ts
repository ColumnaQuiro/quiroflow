// Patient types: categories a clinic defines once (Settings > Patient types),
// gives to patients on their record or many at once from the Patients list,
// and that bring exercises with them (Exercises > By type). Taking a type
// away ends what it brought; an exercise someone removed by hand is not put
// back when the type is updated; and an automation can start on a type.

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

describe('Patient types', () => {
  it('are created in Settings, bring their programme, and update everyone without undoing a hand removal', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'exercises',
        rows: [
          { account_id: account.accountId, name: 'Sentarse y levantarse' },
          { account_id: account.accountId, name: 'Equilibrio a una pierna' },
          { account_id: account.accountId, name: 'Movilidad de cuello' },
        ],
      }).then(([sit, balance, neck]) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: account.accountId, name: 'Movilidad suave' }] }).then(([program]) => {
          cy.task('db:insertRows', {
            table: 'exercise_program_items',
            rows: [
              { account_id: account.accountId, program_id: program.id, exercise_id: sit.id, position: 0, sets: 3, reps: '10' },
              { account_id: account.accountId, program_id: program.id, exercise_id: balance.id, position: 1 },
            ],
          })
          cy.wrap({ program, neck }).as('seed')
        })
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Ríos' }).then((marta) => {
        cy.task('db:updateRows', { table: 'patients', match: { id: marta.id }, values: { tags: ['mayores'] } })
        cy.wrap(marta).as('marta')
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ángel', lastName: 'Morcillo' }).as('angel')

      cy.login(account.email, account.password)

      // Settings: a type, and a tag turned into one.
      cy.visit('/settings/patient-types')
      cy.get('[data-cy="settings-list"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="type-new-name"]').type('Mayor de 65')
      cy.get('[data-cy="type-new-save"]').click()
      cy.contains('[data-cy="type-row"]', 'Mayor de 65').should('contain', '0 patients')
      cy.get('[data-cy="type-new-name"]').type('mayor de 65{enter}')
      cy.contains('There is already a type with that name.')
      cy.get('[data-cy="type-new-name"]').clear()
      cy.get('[data-cy="type-convert-tag"]').select('mayores')
      cy.get('[data-cy="type-convert-save"]').click()
      cy.contains('[data-cy="type-row"]', 'mayores').should('contain', '1 patient')

      // Exercises > By type: the programme it brings.
      cy.visit('/exercises?section=types')
      cy.get('[data-cy="exercises-type-defaults"][data-ready="true"]', { timeout: 20000 })
      cy.contains('[data-cy="type-defaults-type"]', 'Mayor de 65').click()
      cy.get('[data-cy="type-defaults-program"]').select('Movilidad suave')
      cy.contains('Saved')

      // Patients list: give it to both at once.
      cy.visit('/patients')
      cy.get('[data-cy="select-row"]').should('have.length', 2)
      cy.get('[data-cy="select-page"]').check()
      cy.get('[data-cy="bulk-patient-type"]').click()
      cy.contains('[data-cy="type-assign-option"]', 'Mayor de 65').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Give the type').click()
      cy.contains('Type given to 2 patients · 4 exercises assigned')

      // The list filters by it.
      cy.get('@marta').then((marta: unknown) => {
        const martaId = (marta as { id: string }).id
        cy.visit(`/patients/${martaId}?tab=clinical`)
        cy.get('[data-cy="patient-types"]').should('contain', 'Mayor de 65').and('contain', 'mayores')
        cy.get('[data-cy="exercise-row"]').should('have.length', 2)
        cy.contains('[data-cy="exercise-row"]', 'Sentarse y levantarse').should('contain', '3 × 10').find('[data-cy="exercise-row-origin"]').should('contain', 'From the type Mayor de 65')

        // Removed by hand: stays removed when the type is updated.
        cy.contains('[data-cy="exercise-row"]', 'Equilibrio a una pierna').find('[data-cy^="exercise-end-"]').click()
        cy.get('[data-cy="exercise-row"]').should('have.length', 1)

        cy.get<{ program: { id: string }; neck: { id: string } }>('@seed').then(({ program, neck }) => {
          cy.task('db:insertRows', { table: 'exercise_program_items', rows: [{ account_id: account.accountId, program_id: program.id, exercise_id: neck.id, position: 2, sets: 2, reps: '8' }] })
        })
        cy.visit('/exercises?section=types')
        cy.get('[data-cy="exercises-type-defaults"][data-ready="true"]', { timeout: 20000 })
        cy.contains('[data-cy="type-defaults-type"]', 'Mayor de 65').click()
        cy.get('[data-cy="type-defaults-resync"]').click()
        cy.contains('2 patients updated · 2 exercises given · 0 ended')

        cy.visit(`/patients/${martaId}?tab=clinical`)
        cy.get('[data-cy="exercise-row"]').should('have.length', 2)
        cy.get('[data-cy="exercise-row"]').should('contain', 'Movilidad de cuello').and('not.contain', 'Equilibrio a una pierna')

        // Taken away on the record: what it brought ends.
        cy.contains('[data-cy="patient-type-chip"]', 'Mayor de 65').find('[data-cy="patient-type-chip-remove"]').click()
        cy.get('[data-cy="patient-types-end-exercises"]').should('be.checked')
        cy.get('[data-cy="confirm-dialog"]').contains('button', 'Take it away').click()
        cy.get('[data-cy="patient-types"]').should('not.contain', 'Mayor de 65')
        cy.get('[data-cy="exercise-row"]').should('have.length', 0)

        // Given again on the record: it comes back, and the hand removal no longer counts.
        cy.get('[data-cy="patient-types-add"]').click()
        cy.contains('[data-cy="patient-types-option"]', 'Mayor de 65').click()
        cy.get('[data-cy="exercise-row"]').should('have.length', 3)
      })
    })
  })

  it('starts the automations on a type, which can give exercises themselves', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Respiración costal' }] }).then(([breathing]) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: account.accountId, name: 'Embarazo' }] }).then(([program]) => {
          cy.task('db:insertRows', { table: 'exercise_program_items', rows: [{ account_id: account.accountId, program_id: program.id, exercise_id: breathing.id, position: 0 }] })
          cy.task<{ id: string }[]>('db:insertRows', {
            table: 'patient_types',
            rows: [
              { account_id: account.accountId, name: 'Embarazada' },
              { account_id: account.accountId, name: 'Deportista' },
            ],
          }).then(([pregnant, athlete]) => {
            cy.task('db:createAutomationRule', {
              accountId: account.accountId,
              triggerEvent: 'patient.type_added',
              name: 'Bienvenida embarazo',
              filters: { trigger_type_id: pregnant.id },
              actions: [{ type: 'assign_exercises', config: { kind: 'program', program_id: program.id } }],
            })
            cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lucía', lastName: `Prueba${stamp()}` }).then((p) => {
              cy.login(account.email, account.password)
              // Another type: nothing.
              cy.request({ method: 'POST', url: '/api/patient-types/assign', body: { patientIds: [p.id], add: [athlete.id] } }).its('body.added').should('eq', 1)
              cy.task<unknown[]>('db:selectRows', { table: 'patient_exercises', columns: 'id', match: { patient_id: p.id } }).should('have.length', 0)
              // The type the automation names: its step gives the programme.
              cy.request({ method: 'POST', url: '/api/patient-types/assign', body: { patientIds: [p.id], add: [pregnant.id] } }).its('body.added').should('eq', 1)
              cy.task<{ exercise_id: string }[]>('db:selectRows', { table: 'patient_exercises', columns: 'exercise_id', match: { patient_id: p.id } })
                .should('have.length', 1)
                .its('0.exercise_id')
                .should('eq', breathing.id)
            })
          })
        })
      })
    })
  })
})
