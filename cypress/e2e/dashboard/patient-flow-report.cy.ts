// Reports > Patient Flow: waits, delays and session times from the calendar's
// flow stamps (Arrived, Into session, Checkout). Two tracked visits with
// known stamps and one completed visit nobody checked in; every figure below
// follows from those. The arithmetic itself is unit-tested
// (tests/unit/patient-flow-stats.test.ts); this pins the page reading it.

describe('Patient Flow report', () => {
  it('shows waits, delays, sessions and coverage from the flow stamps', () => {
    // Today, so the default "this month" range always holds them.
    const base = new Date()
    base.setHours(1, 0, 0, 0)
    const m = (min: number) => new Date(base.getTime() + min * 60_000).toISOString()

    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Gil' }).then((patient) => {
        const visit = (o: Record<string, unknown>) =>
          cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, status: 'completed', ...o })
        // Arrived 5 early, in 12 late, 28 in session: wait 17, delay 12.
        visit({ startsAt: m(0), checkedInAt: m(-5), flowWithPractitionerAt: m(12), flowCheckoutAt: m(40) })
        // Arrived 2 early, in 1 late, 20 in session: wait 3, delay 1.
        visit({ startsAt: m(60), checkedInAt: m(58), flowWithPractitionerAt: m(61), flowCheckoutAt: m(81) })
        // Completed, never checked in: in the coverage denominator only.
        visit({ startsAt: m(120) })
      })

      cy.login(account.email, account.password)
      cy.visit('/reports/patient-flow')
      cy.get('[data-cy="patient-flow"][data-ready="true"]')
      cy.get('[data-cy="flow-tracked"]').should('have.text', '2')
      cy.get('[data-cy="patient-flow"]').should('contain', '67% of completed visits')
      cy.get('[data-cy="flow-wait"]').should('have.text', '10 min')
      cy.get('[data-cy="flow-on-time"]').should('have.text', '50%')
      cy.get('[data-cy="flow-session"]').should('have.text', '24 min')
      cy.get('[data-cy="flow-arrival"]').should('have.text', '3 min early')

      // The distribution follows the stage picked.
      cy.get('[data-cy="flow-distribution"]').should('contain', '50%')
      cy.get('[data-cy="flow-stage-session"]').click()
      cy.get('[data-cy="flow-distribution"] div.flex').eq(4).should('contain', '100%') // 20+ min: both sessions

      cy.get('[data-cy="flow-by-practitioner"] tbody tr').should('have.length', 1).and('contain', '10 min').and('contain', '24 min')
    })
  })

  it('says the flow is not in use rather than showing zeros', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/reports/patient-flow')
      cy.get('[data-cy="patient-flow-empty"]').should('be.visible')
      cy.get('[data-cy="flow-wait"]').should('have.text', '–')
    })
  })
})
