// A care plan's progress is the visits completed SINCE IT STARTED -- the rule
// care_plan_continuity_alerts (0131), the Clinical tab and the app use. The
// Overview card and the patient list counted every completed visit the
// patient ever had, so a returning patient's new plan read half done on day
// one, and every reader counted visits the clinic had deleted.

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('Care plan progress', () => {
  it('counts the completed visits since the plan started, and none that were deleted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Vuelve' }).then((patient) => {
        cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 10, name: 'Plan lumbar', startedAt: localDate(daysFromNow(-10)) })
        const appt = (startsAt: Date, extra: Record<string, unknown>) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: startsAt.toISOString(), ...extra })
        // A course of care last year: not this plan's.
        appt(daysFromNow(-400), { status: 'completed' })
        appt(daysFromNow(-399), { status: 'completed' })
        appt(daysFromNow(-398), { status: 'completed' })
        // This plan's two.
        appt(daysFromNow(-7), { status: 'completed' })
        appt(daysFromNow(-3), { status: 'completed' })
        // Deleted, so no visit at all -- one done, one ahead.
        appt(daysFromNow(-5), { status: 'completed', deletedAt: new Date().toISOString() })
        appt(daysFromNow(5), { deletedAt: new Date().toISOString() })

        cy.login(account.email, account.password)
        cy.visit('/patients')
        cy.contains('tr', 'Rosa Vuelve').should('contain.text', 'Plan lumbar').and('contain.text', '2/10')
        // The deleted visit ahead is no booking.
        cy.contains('tr', 'Rosa Vuelve').should('contain.text', 'No booking')

        cy.visit(`/patients/${patient.id}`)
        cy.contains('Plan lumbar').parent().should('contain.text', 'Visit 2 of 10')

        cy.visit(`/patients/${patient.id}?tab=clinical`)
        cy.contains('2 of 10 visits').should('be.visible')
      })
    })
  })
})
