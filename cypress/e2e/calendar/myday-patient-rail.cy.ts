import { todayAt } from '../../support/calendar'

// My Day keeps the patient beside the note: the red and yellow flags, the
// patient's own note, where they are in the plan, and what they owe, in a
// column of their own while the visit is open. They used to sit under the
// note, two screens down at 1440x900, so the one thing not to miss mid-
// treatment was never on screen. Opening a visit folds the day to a strip.

function seedFlaggedVisit(account: { accountId: string; clinicId: string }, practitionerId: string) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa', lastName: 'Alerta' }).then((patient) => {
    cy.task('db:updateRows', {
      table: 'patients',
      values: { red_flags: 'Osteoporosis: no high-velocity thrust', yellow_flags: 'Fear of movement after a fall', sticky_note: 'Prefers to be called Rosi', chief_complaint: 'Knee pain' },
      match: { id: patient.id },
    })
    const lastWeek = new Date(todayAt(10, 0))
    lastWeek.setDate(lastWeek.getDate() - 7)
    const twoWeeksAgo = new Date(lastWeek)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7)
    cy.task('db:createCarePlan', { accountId: account.accountId, patientId: patient.id, totalVisits: 12, startedAt: twoWeeksAgo.toISOString() })
    cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId, startsAt: lastWeek.toISOString(), status: 'completed' })
    cy.task('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: patient.id, practitionerId, startsAt: todayAt(10, 0) })
    cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 3800, status: 'unpaid' })
    return cy.wrap(patient)
  })
}

describe('My Day keeps the patient in view', () => {
  it('shows the flags, the note, the plan and the debt beside the note, and edits the flags in place', () => {
    cy.seedStaffAccount().then((account) => {
      seedFlaggedVisit(account, account.teamMemberId).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit('/practitioner')
        cy.get('[data-cy=myday-worklist]', { timeout: 20000 }).should('have.attr', 'data-folded', 'false')
        cy.contains('li:not([data-cy=needs-confirming-row])', 'Rosa Alerta').click()
        cy.get('[data-cy=myday-worklist]').should('have.attr', 'data-folded', 'true')

        cy.get('[data-cy=myday-rail]').within(() => {
          cy.get('[data-cy=rail-alerts]').should('have.attr', 'data-tone', 'danger')
          cy.get('[data-cy=rail-red-flags]').should('contain', 'Osteoporosis: no high-velocity thrust')
          cy.get('[data-cy=rail-yellow-flags]').should('contain', 'Fear of movement after a fall')
          cy.get('[data-cy=rail-complaint]').should('have.text', 'Knee pain')
          cy.get('[data-cy=rail-sticky-note]').should('contain', 'Prefers to be called Rosi')
          // Last week's visit and today's: the second of twelve, and nothing after it booked.
          cy.get('[data-cy=rail-plan-position]').should('have.text', '2 of 12')
          cy.get('[data-cy=rail-next-visit]').should('contain', 'Not booked')
          cy.get('[data-cy=rail-owed]').should('contain', '38,00')
        })
        // In the first screen, beside the note, without scrolling.
        cy.get('[data-cy=rail-red-flags]').then(($f) => expect($f[0]!.getBoundingClientRect().bottom).to.be.lessThan(900))
        cy.get('[data-cy=myday-today]').should('be.visible')

        cy.get('[data-cy=rail-alerts-edit]').click()
        cy.get('[data-cy=myday-rail] textarea[id$="-redFlags"]').clear().type('Anticoagulants')
        cy.get('[data-cy=flags-done]').click()
        cy.get('[data-cy=rail-red-flags]').should('contain', 'Anticoagulants')
        cy.task<{ red_flags: string }[]>('db:selectRows', { table: 'patients', columns: 'red_flags', match: { id: patient.id } }).its('0.red_flags').should('eq', 'Anticoagulants')

        // The whole day, one tap away.
        cy.get('[data-cy=myday-list-open]').click()
        cy.get('[data-cy=myday-worklist]').should('have.attr', 'data-folded', 'false')
        cy.contains('li:not([data-cy=needs-confirming-row])', 'Rosa Alerta').find('[data-cy=worklist-red-flags]').should('exist')
      })
    })
  })

  it('leaves out what is owed for a role that cannot see billing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setRolePermissions', { accountId: account.accountId, roleName: 'Practitioner', patch: { billing_history_view: false } })
      const email = `prac-rail-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.test`
      cy.task<{ teamMemberId: string }>('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Practitioner', email, password: 'Test1234!', fullName: 'Prac Rail', isPractitioner: true }).then((member) => {
        seedFlaggedVisit(account, member.teamMemberId).then(() => {
          cy.login(email, 'Test1234!')
          cy.visit('/practitioner')
          cy.contains('li:not([data-cy=needs-confirming-row])', 'Rosa Alerta', { timeout: 20000 }).click()
          cy.get('[data-cy=myday-rail] [data-cy=rail-red-flags]').should('contain', 'Osteoporosis')
          cy.get('[data-cy=myday-rail] [data-cy=rail-plan]').should('be.visible')
          cy.get('[data-cy=rail-owed]').should('not.exist')
        })
      })
    })
  })
})
