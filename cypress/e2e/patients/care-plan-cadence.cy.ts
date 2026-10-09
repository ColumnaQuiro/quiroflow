// A care plan's cadence is "N visits every M weeks" (care_plans.visits_per_period
// and frequency_value). It used to be one number the web form called "visits
// a week" and everything that books or chases called "every N weeks", so a
// plan entered as 2 a week was booked and chased every fortnight.

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('Care plan cadence', () => {
  it('is set as N visits every M weeks, and read that way on the record', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bruno', lastName: 'Sanz' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.get('[data-cy="care-plan-edit"]').click()
        cy.get('[data-cy="plan-visits-per-period"]').clear().type('2')
        cy.get('[data-cy="plan-every"]').clear().type('1')
        cy.get('[data-cy="plan-cadence-preview"]').should('have.text', '2× a week')
        cy.get('[data-cy="plan-every"]').clear().type('2')
        cy.get('[data-cy="plan-cadence-preview"]').should('have.text', '2× every 2 weeks')
        cy.get('[data-cy="plan-every"]').clear().type('1')
        cy.contains('button', 'Save').click()
        cy.get('[data-cy="care-plan-summary"]').should('contain', '2× a week')
        cy.task<{ visits_per_period: number; frequency_value: number }[]>('db:selectRows', { table: 'care_plans', columns: 'visits_per_period, frequency_value', match: { patient_id: patient.id } })
          .its('0').should('deep.equal', { visits_per_period: 2, frequency_value: 1 })
      })
    })
  })

  it('is chased by Care Plan Alerts after the gap between visits, not after the interval', () => {
    cy.seedStaffAccount().then((account) => {
      const patientWithPlan = (firstName: string, plan: Record<string, unknown>) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName: 'Plan' }).then((p) => {
          cy.task('db:createCarePlan', { accountId: account.accountId, patientId: p.id, totalVisits: 12, startedAt: localDate(daysFromNow(-20)), ...plan })
          // Last seen 6 days ago, nothing booked.
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(-6).toISOString(), status: 'completed' })
        })
      // 2 a week: due 4 days after the last visit, so 2 days overdue.
      patientWithPlan('Intensivo', { frequencyValue: 1, visitsPerPeriod: 2 })
      // 1 every 2 weeks: not due for another 8 days.
      patientWithPlan('Mantenimiento', { frequencyValue: 2 })

      cy.login(account.email, account.password)
      cy.visit('/care-plan-alerts')
      cy.contains('tr', 'Intensivo Plan').should('contain', '2× a week').and('contain', '2 days')
      cy.contains('tr', 'Mantenimiento Plan').should('not.exist')
    })
  })
})
