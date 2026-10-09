// Care Plan Alerts' "Home exercises not being done": patients with the app
// and an active home exercise who have ticked nothing for 5+ days, counted
// from the later of their last tick and their newest assignment
// (exercise_adherence_alerts). Each patient below is one edge of that rule.

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const dayAgo = (n: number) => daysAgo(n).toISOString().slice(0, 10)

describe('Exercise adherence alerts', () => {
  it('lists the patients who stopped ticking, and nobody else', () => {
    const stamp = Date.now()
    cy.seedStaffAccount().then((account) => {
      const patient = (firstName: string, withApp: boolean) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Prueba' }).then((p) => {
          if (withApp) cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: p.id, email: `adh-${firstName.toLowerCase()}-${stamp}@example.test`, password: 'valencia2026' })
          return cy.wrap(p)
        })
      const assign = (patientId: string, exerciseId: string, assignedDaysAgo: number, ticked: number[] = []) =>
        cy.task<{ id: string }[]>('db:insertRows', {
          table: 'patient_exercises',
          rows: [{ account_id: account.accountId, patient_id: patientId, exercise_id: exerciseId, created_at: daysAgo(assignedDaysAgo).toISOString() }],
        }).then(([pe]) => {
          if (ticked.length) cy.task('db:insertRows', { table: 'patient_exercise_logs', rows: ticked.map((d) => ({ account_id: account.accountId, patient_exercise_id: pe.id, done_on: dayAgo(d) })) })
        })

      cy.task<{ id: string }[]>('db:insertRows', { table: 'exercises', rows: [{ account_id: account.accountId, name: 'Puente' }, { account_id: account.accountId, name: 'Plancha' }] }).then(([ex, ex2]) => {
        patient('Lapsed', true).then((p) => assign(p.id, ex.id, 10, [9, 7]))      // last tick 7 days ago: listed, 7 days
        patient('Never', true).then((p) => assign(p.id, ex.id, 8))               // given 8 days ago, never ticked: listed
        patient('Today', true).then((p) => assign(p.id, ex.id, 10, [0]))         // ticked today
        patient('Noapp', false).then((p) => assign(p.id, ex.id, 10))             // cannot tick without the app
        patient('Fresh', true).then((p) => assign(p.id, ex.id, 2))               // given two days ago
        patient('Renewed', true).then((p) => {                                    // old one lapsed, but given a new one yesterday
          assign(p.id, ex.id, 20, [15])
          assign(p.id, ex2.id, 1)
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/care-plan-alerts')
      cy.get('[data-cy="exercise-alert-row"]').should('have.length', 2)
      cy.get('[data-cy="exercise-alert-row"]').eq(0).should('contain', 'Never Prueba').and('contain', 'Never').and('contain', '8 days')
      cy.get('[data-cy="exercise-alert-row"]').eq(1).should('contain', 'Lapsed Prueba').and('contain', '7 days')
      cy.get('[data-cy="exercise-alerts"]').should('not.contain', 'Today Prueba').and('not.contain', 'Noapp').and('not.contain', 'Fresh').and('not.contain', 'Renewed')

      // The row opens the record's Clinical tab, where the exercises are.
      cy.contains('[data-cy="exercise-alert-row"] a', 'Lapsed Prueba').click()
      cy.location('search').should('contain', 'tab=clinical')
      cy.get('[data-cy="staff-exercises"]').should('contain', 'Puente')
    })
  })
})
