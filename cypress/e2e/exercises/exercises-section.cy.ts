// The Exercises section: every patient's home exercises in one table, and
// assigning or ending them for many at once instead of record by record.
// The library that was Settings > Exercise Library lives here now, behind
// its own permission (exercises_manage), and its old address redirects.

describe('Exercises section', () => {
  it('lists patients with their exercises, assigns a programme to all that match, and ends them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'exercises',
        rows: [
          { account_id: account.accountId, name: 'Sentarse y levantarse' },
          { account_id: account.accountId, name: 'Equilibrio a una pierna' },
        ],
      }).then(([sit, balance]) => {
        cy.task<{ id: string }[]>('db:insertRows', { table: 'exercise_programs', rows: [{ account_id: account.accountId, name: 'Movilidad suave' }] }).then(([program]) => {
          cy.task('db:insertRows', {
            table: 'exercise_program_items',
            rows: [
              { account_id: account.accountId, program_id: program.id, exercise_id: sit.id, position: 0, sets: 3, reps: '10' },
              { account_id: account.accountId, program_id: program.id, exercise_id: balance.id, position: 1, reps: '30 s' },
            ],
          })
        })
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Marta', lastName: 'Ríos' }).then((marta) => {
          // Already does one of them: it is kept, not given twice.
          cy.task('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: account.accountId, patient_id: marta.id, exercise_id: sit.id, sets: 2, reps: '8' }] })
        })
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Jorge', lastName: 'Alcañiz' })
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Benítez' })
      })

      cy.login(account.email, account.password)
      cy.visit('/exercises')
      cy.get('[data-cy="exercises-overview"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="overview-row"]').should('have.length', 3)
      cy.get('[data-cy="overview-stat-with"]').should('have.text', '1')
      cy.get('[data-cy="overview-stat-without"]').should('have.text', '2')

      // Only those without exercises.
      cy.get('[data-cy="overview-exercises-no"]').click()
      cy.get('[data-cy="overview-row"]').should('have.length', 2).and('not.contain', 'Marta')
      cy.get('[data-cy="overview-exercises-any"]').click()
      cy.get('[data-cy="overview-row"]').should('have.length', 3)

      // Everyone on the page, one programme.
      cy.get('[data-cy="overview-select-page"]').check()
      cy.get('[data-cy="overview-selection-count"]').should('contain', '3 selected')
      cy.get('[data-cy="overview-bulk-assign"]').click()
      cy.get('[data-cy="bulk-assign-program"]').select('Movilidad suave')
      cy.get('[data-cy="bulk-assign-preview"]').should('contain', '1 already have some of these')
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'Assign to 3 patients').click()
      cy.contains('5 exercises assigned to 3 patients')
      cy.get('[data-cy="overview-stat-with"]').should('have.text', '3')
      cy.contains('[data-cy="overview-row"]', 'Rosa').find('[data-cy="overview-row-exercises"]').should('contain', 'Sentarse y levantarse').and('contain', 'Equilibrio a una pierna')

      // The existing one kept its own dose.
      cy.contains('[data-cy="overview-row"]', 'Marta').find('[data-cy="overview-row-name"]').click()
      cy.contains('[data-cy="exercise-row"]', 'Sentarse y levantarse').should('contain', '2 × 8')
      cy.contains('[data-cy="exercise-row"]', 'Equilibrio a una pierna').find('[data-cy="exercise-row-origin"]').should('contain', 'Added by')

      // Ending them for everyone keeps nothing on.
      cy.visit('/exercises')
      cy.get('[data-cy="exercises-overview"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="overview-select-page"]').check()
      cy.get('[data-cy="overview-bulk-end"]').click()
      cy.get('[data-cy="confirm-dialog"]').contains('button', 'End exercises').click()
      cy.contains('6 exercises ended')
      cy.get('[data-cy="overview-stat-with"]').should('have.text', '0')
    })
  })

  it('keeps the library at its old address, and is closed to a role without the permission', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/exercises?tab=programs')
      cy.location('pathname').should('eq', '/exercises')
      cy.location('search').should('contain', 'section=library').and('contain', 'tab=programs')
      cy.get('[data-cy="settings-list"][data-ready="true"]', { timeout: 20000 })
      cy.get('[data-cy="exercises-tab-programs"]').should('have.attr', 'aria-selected', 'true')

      // Front Desk has patients_edit but not exercises_manage.
      const email = `fd.${Date.now()}@example.test`
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password: 'Password123!' })
      cy.clearCookies()
      cy.clearLocalStorage()
      cy.login(email, 'Password123!')
      cy.visit('/patients')
      cy.get('nav').should('not.contain', 'Exercises')
      cy.visit('/exercises', { failOnStatusCode: false })
      cy.location('pathname').should('not.eq', '/exercises')

      // And the database agrees: bulk assigning is refused to them.
      cy.task<{ data: unknown; error: string | null }>('db:rpcAsStaff', {
        email,
        password: 'Password123!',
        fn: 'assign_exercises_to_patients',
        args: { p_account_id: account.accountId, p_patient_ids: [], p_filters: null, p_clinic_id: null, p_items: [] },
      }).its('error').should('contain', 'cannot assign exercises in bulk')
      cy.task<{ permissions: Record<string, unknown> }[]>('db:selectRows', { table: 'account_roles', columns: 'permissions', match: { account_id: account.accountId, name: 'Practitioner' } })
        .its('0.permissions.exercises_manage').should('eq', true)
    })
  })
})
