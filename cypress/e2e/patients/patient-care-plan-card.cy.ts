// The patient's own care plan card (components/patient/CarePlanCard.vue), in
// the portal: how far along they are, the plan's booked dates, and asking the
// clinic to move one -- which lands in Messages written for them, not sent.
// The counting is unit-tested (tests/unit/patient-plan-progress.test.ts).

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('Patient care plan card', () => {
  it('shows progress and booked dates, and asks the clinic to change one', () => {
    const email = `plan-card-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Plan' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 6, name: 'Plan cervical', startedAt: localDate(daysFromNow(-14)) })
        const appt = (startsAt: Date, extra: Record<string, unknown> = {}) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: startsAt.toISOString(), ...extra })
        appt(daysFromNow(-10), { status: 'completed' })
        appt(daysFromNow(-3), { status: 'completed' })
        appt(daysFromNow(4))
        appt(daysFromNow(11))

        cy.login(email, password)
        cy.visit('/portal')
        cy.get('[data-cy=patient-plan]').should('contain.text', 'Plan cervical').and('contain.text', '4 visits left')
        cy.get('[data-cy=patient-plan-count]').should('contain.text', '2').and('contain.text', 'of 6')
        cy.get('[data-cy=patient-plan-booked] li').should('have.length', 2)
        cy.get('[data-cy=patient-plan-to-book]').should('contain.text', '2 visits still have no date')

        // No slot picker on the web: it becomes a message, waiting to be sent.
        cy.get('[data-cy=patient-plan-change]').first().should('contain.text', 'Ask to change').click()
        cy.location('pathname').should('eq', '/portal/messages')
        cy.get('textarea').invoke('val').should('match', /could I change my visit on .+ to another time/)
      })
    })
  })

  it('shows nothing when there is no plan', () => {
    const email = `plan-none-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Leo', lastName: 'Sinplan' }).then((patient) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.login(email, password)
        cy.visit('/portal')
        cy.contains('Your next visit').should('be.visible')
        cy.get('[data-cy=patient-plan]').should('not.exist')
      })
    })
  })
})
