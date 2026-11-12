// Cuidarme in the patient app counts a day when the patient ticked a home
// exercise or one of their own habits (habit_checkins, 20261105162805). The
// record shows the same, under "Home exercises" (components/exercises/
// CareConsistency.vue) -- and a merge keeps the ticks, since merge_patients
// moves them off the duplicate rather than letting the cascade take them.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const dayAgo = (n: number) => daysAgo(n).toISOString().slice(0, 10)

describe('Care consistency on the record', () => {
  it('counts exercise and habit ticks as one streak, and a merge keeps the habits', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Constante' }).then((patient) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Duplicada' }).then((duplicate) => {
          cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Puente' }] }).then(([ex]) => {
            cy.task<{ id: string }[]>('db:insertRows', { table: 'patient_exercises', rows: [{ account_id: account.accountId, patient_id: patient.id, exercise_id: ex!.id }] }).then(([pe]) => {
              cy.task('db:insertRows', { table: 'patient_exercise_logs', rows: [2, 3].map((d) => ({ account_id: account.accountId, patient_exercise_id: pe!.id, done_on: dayAgo(d) })) })
            })
          })
          // Today and yesterday by habits only, on the duplicate record.
          cy.task('db:insertRows', {
            table: 'habit_checkins',
            rows: [0, 1].map((d) => ({ account_id: account.accountId, patient_id: duplicate.id, habit: 'agua', done_at: daysAgo(d).toISOString(), client_id: crypto.randomUUID() })),
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)
          cy.get('button[aria-label="More actions"]').click()
          cy.contains('button', 'Merge with another record').click()
          cy.get('#merge-search').type('Duplicada')
          cy.contains('button', 'Rosa Duplicada').click()
          cy.get('[data-cy=merge-submit]').click()
          // The app's own question, which says the merge cannot be undone.
          cy.get('[data-cy=confirm-dialog]').should('contain.text', 'undone')
          cy.get('[data-cy=confirm-dialog-confirm]').click()
          cy.contains('Patients merged').should('be.visible')
          cy.task<{ patient_id: string }[]>('db:selectRows', { table: 'habit_checkins', columns: 'patient_id', match: { account_id: account.accountId } }).should((rows) => {
            expect(rows).to.have.length(2)
            expect(rows.every((r) => r.patient_id === patient.id)).to.eq(true)
          })

          // Days 3 and 2 by exercises, 1 and 0 by habits: four in a row.
          cy.visit(`/patients/${patient.id}?tab=clinical`)
          cy.get('[data-cy=care-consistency]', { timeout: 20000 }).should('contain', '4-day streak').and('contain', '2 habits ticked this week')
        })
      })
    })
  })
})
