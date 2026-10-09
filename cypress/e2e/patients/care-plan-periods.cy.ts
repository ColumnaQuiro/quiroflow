// The care plan, period by period, on the record's Overview: one circle a
// period, done out of expected, coloured by how it went, and whether the
// plan is on track. The rules are unit-tested (care-plan-periods.test.ts).

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('Care plan periods', () => {
  it('shows each week of a 2-a-week plan, and that it fell behind', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iris', lastName: 'Campos' }).then((patient) => {
        // Started two weeks ago: weeks 1 and 2 are over, week 3 is now.
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 10, name: 'Fase intensiva', startedAt: localDate(daysFromNow(-14)), frequencyValue: 1, visitsPerPeriod: 2 })
        const visit = (days: number, status: string) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: daysFromNow(days).toISOString(), status })
        visit(-14, 'completed')
        visit(-11, 'completed') // week 1: both
        visit(-6, 'completed') // week 2: one short
        visit(1, 'booked') // week 3: one booked so far

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)
        cy.get('[data-cy="plan-periods"][data-ready="true"]', { timeout: 20000 })
        cy.get('[data-cy="plan-period"]').then((els) => {
          expect([...els].map((e) => e.getAttribute('data-status'))).to.deep.equal(['completed', 'behind', 'current', 'unscheduled', 'unscheduled'])
        })
        cy.get('[data-cy="plan-period"]').eq(0).should('contain', '2/2')
        cy.get('[data-cy="plan-period"]').eq(1).should('contain', '1/2')
        cy.get('[data-cy="plan-period"]').eq(2).should('contain', 'Now')
        cy.get('[data-cy="plan-period-now"]').should('contain', 'This period: 0 of 2').and('contain', '(1 booked)')
        cy.get('[data-cy="plan-on-track"]').should('have.text', 'Behind')
      })
    })
  })
})
