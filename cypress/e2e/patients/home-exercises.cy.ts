// Home exercises: the practitioner assigns one on the record, the patient
// sees it in the portal and ticks today off, and the record shows the tick.
// The patient's tick goes through set_my_exercise_done; they have no other
// write here.

describe('Home exercises', () => {
  it('assigned on the record, done by the patient, seen by the practitioner', () => {
    const email = `exercises-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Vidal' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })

        // The practitioner assigns a new one, which also lands in the library.
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="staff-exercises"]').should('contain.text', 'None assigned yet')
        cy.get('[data-cy="exercises-assign-open"]').click()
        cy.get('[data-cy="exercise-name"]').type('Gato-camello')
        cy.get('[data-cy="exercise-link"]').type('https://example.com/gato-camello')
        cy.get('[data-cy="exercise-sets"]').type('3')
        cy.get('[data-cy="exercise-reps"]').type('10')
        cy.get('[data-cy="exercise-frequency"]').type('2 veces al día')
        cy.get('[data-cy="exercise-save"]').click()
        cy.get('[data-cy="exercise-row"]').should('have.length', 1).and('contain.text', 'Gato-camello').and('contain.text', '3 × 10 · 2 veces al día')
        cy.logout()

        // The patient sees it and ticks today.
        cy.login(email, password)
        cy.visit('/portal/exercises')
        cy.get('[data-cy="patient-exercise"]').should('have.length', 1).and('contain.text', 'Gato-camello')
        cy.get('[data-cy="exercise-done-today"]').should('contain.text', 'Done today').click()
        cy.get('[data-cy="exercise-done-today"]').should('contain.text', '✓ Done today')
        cy.reload()
        cy.get('[data-cy="exercise-done-today"]').should('contain.text', '✓ Done today')
        // The portal has no staff account menu to sign out from.
        cy.clearAllCookies()
        cy.clearAllLocalStorage()

        // Back on the record, today is ticked.
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="exercise-row"] .bg-success-accent').should('have.length', 1)
        cy.get('[data-cy="exercise-adherence"]').should('contain.text', '1 of 7 days')
      })
    })
  })
})
