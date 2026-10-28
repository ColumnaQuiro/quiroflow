// QuiroFlow's starter exercise catalogue (utils/exerciseCatalog.ts): added
// from Settings > Exercise Library one at a time or as a starter programme,
// and straight from the patient's record while assigning. Adding copies the
// exercise into the clinic's library, once -- starter_key is unique per
// account, and one archived is restored rather than doubled -- and the patient
// watches its demonstration video in the portal.

describe('Exercise catalogue', () => {
  it('adds each exercise to the library once, from Settings or the record, and the patient plays its video', () => {
    const email = `catalogue-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Ferrer' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })

        cy.login(account.email, account.password)
        cy.visit('/settings/exercises')
        cy.get('[data-cy="settings-list"][data-ready="true"]')

        // One exercise, with its demonstration.
        cy.get('[data-cy="catalog-region-back"]').click()
        cy.contains('[data-cy="catalog-exercise"]', 'Glute bridge').find('[data-cy="catalog-exercise-add"]').click()
        cy.contains('[data-cy="library-row"]', 'Glute bridge').find('[data-cy="library-row-catalog-video"]').should('exist')
        cy.contains('[data-cy="catalog-exercise"]', 'Glute bridge').find('[data-cy="catalog-exercise-added"]').should('exist')

        // A starter programme: its exercises join the library, the bridge is not doubled.
        cy.get('[data-cy="catalog-region-programs"]').click()
        cy.contains('[data-cy="catalog-program"]', 'Low back basics').find('[data-cy="catalog-program-add"]').click()
        cy.contains('[data-cy="catalog-program"]', 'Low back basics').find('[data-cy="catalog-program-added"]').should('exist')
        cy.contains('[data-cy="program-row"]', 'Low back basics').should('contain', '5 exercises')
        cy.get('[data-cy="library-row"]').should('have.length', 5)

        // Archived and added again: the same row comes back.
        cy.contains('[data-cy="library-row"]', 'Cat-camel').find('[data-cy="library-archive"]').click()
        cy.contains('[data-cy="library-archived-row"]', 'Cat-camel').should('exist')
        cy.get('[data-cy="catalog-region-back"]').click()
        cy.contains('[data-cy="catalog-exercise"]', 'Cat-camel').find('[data-cy="catalog-exercise-add"]').click()
        cy.contains('[data-cy="library-row"]', 'Cat-camel').should('exist')
        cy.get('[data-cy="library-archived"]').should('not.exist')

        // On the record, straight from the catalogue, with its usual dose.
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="exercises-assign-open"]').click()
        cy.get('[data-cy="exercise-search"]').type('chin')
        cy.contains('[data-cy="exercise-option"]', 'Chin tuck').find('input').check()
        cy.get('[data-cy="exercise-pick-preview"] [data-cy="catalog-video"]').should('have.attr', 'src', '/exercise-catalog/chin-tuck.mp4')
        cy.contains('[data-cy="exercise-chosen"]', 'Chin tuck').find('[data-cy="exercise-sets"]').should('have.value', '2')
        cy.get('[data-cy="exercise-save"]').should('contain.text', 'Assign 1').click()
        cy.contains('[data-cy="exercise-row"]', 'Chin tuck').should('contain.text', '2 × 10 · Twice a day')

        // Copied now, so offered once, from the library, as one the patient
        // has; ticking a starter programme takes only the rest of it, and
        // another exercise ticked by hand goes in the same assignment.
        cy.get('[data-cy="exercises-assign-open"]').click()
        cy.get('[data-cy="exercise-search"]').type('chin')
        cy.get('[data-cy="exercise-option"]').should('have.length', 1).and('contain.text', 'Already has it').find('input').should('be.disabled')
        cy.get('[data-cy="exercise-search"]').clear()
        cy.contains('[data-cy="exercise-group"]', 'Neck pain').find('input').check()
        cy.get('[data-cy="exercise-chosen"]').should('have.length', 4).and('contain.text', 'Neck rotation')
        cy.contains('[data-cy="exercise-option"]', 'Cat-camel').find('input').check()
        cy.get('[data-cy="exercise-save"]').should('contain.text', 'Assign 5').click()
        cy.get('[data-cy="exercise-row"]').should('have.length', 6)

        // Ten exercises in the library, each once.
        cy.task<{ starter_key: string | null }[]>('db:selectRows', { table: 'exercises', columns: 'starter_key', match: { account_id: account.accountId } }).then((rows) => {
          expect(rows).to.have.length(10)
          expect(new Set(rows.map((r) => r.starter_key)).size).to.eq(10)
        })
        cy.logout()

        // The patient plays the demonstration in the portal.
        cy.login(email, password)
        cy.visit('/portal/exercises')
        cy.contains('[data-cy="patient-exercise"]', 'Chin tuck').find('[data-cy="exercise-catalog-toggle"]').click()
        cy.contains('[data-cy="patient-exercise"]', 'Chin tuck').find('[data-cy="exercise-catalog-player"] video').should('have.attr', 'src', '/exercise-catalog/chin-tuck.mp4')
        cy.request('/exercise-catalog/chin-tuck.mp4').its('headers.content-type').should('contain', 'video/mp4')
      })
    })
  })
})
