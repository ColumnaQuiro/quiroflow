// "Needs confirming" on My Day (components/practitioner/NeedsConfirming.vue):
// visits between now and tomorrow night nobody has confirmed, riskiest first,
// with the no-show risk from the patient's last year (utils/noShowRisk.ts,
// unit-tested in tests/unit/no-show-risk.test.ts).

function daysFromNow(days: number, h = 10) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

describe('Needs confirming', () => {
  it('lists unconfirmed visits riskiest first, and marks one confirmed', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (first: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Confirma' })
      const visit = (patientId: string, startsAt: string, extra: Record<string, unknown> = {}) =>
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId: account.teamMemberId, startsAt, ...extra })

      patient('Fiable').then((fiable) => {
        patient('Despistada').then((despistada) => {
          patient('Segura').then((segura) => {
            // Turns up.
            visit(fiable.id, daysFromNow(-30), { status: 'completed' })
            visit(fiable.id, daysFromNow(-20), { status: 'completed' })
            visit(fiable.id, daysFromNow(1, 9))
            // Missed two of her last three.
            visit(despistada.id, daysFromNow(-40), { status: 'no_show' })
            visit(despistada.id, daysFromNow(-25), { status: 'completed' })
            visit(despistada.id, daysFromNow(-10), { status: 'no_show' })
            visit(despistada.id, daysFromNow(1, 12)).then((risky) => {
              // Already said yes: not on the list.
              visit(segura.id, daysFromNow(1, 11), { confirmationStatus: 'confirmed' })

              cy.login(account.email, account.password)
              cy.visit('/practitioner')
              cy.get('[data-cy=needs-confirming]').should('be.visible')
              cy.get('[data-cy=needs-confirming-row]').should('have.length', 2)
              cy.get('[data-cy=needs-confirming-count]').should('contain.text', '1 at risk')
              // Riskiest first, though later in the day.
              cy.get('[data-cy=needs-confirming-row]').first().should('contain.text', 'Despistada').and('contain.text', 'Missed 2 of 3')
              cy.get('[data-cy=needs-confirming-row]').first().find('[data-cy=no-show-risk]').should('have.attr', 'data-level', 'high')
              cy.get('[data-cy=needs-confirming-row]').last().should('contain.text', 'Fiable').find('[data-cy=no-show-risk]').should('not.exist')
              cy.contains('[data-cy=needs-confirming]', 'Segura').should('not.exist')

              // Confirmed on the phone: off the list, and recorded on the visit.
              cy.get('[data-cy=needs-confirming-row]').first().find('[data-cy=needs-confirming-confirm]').click()
              cy.get('[data-cy=needs-confirming-row]').should('have.length', 1)
              cy.task<{ confirmation_status: string | null }>('db:appointmentById', { appointmentId: risky.id }).its('confirmation_status').should('eq', 'confirmed')

              // Message opens their Inbox conversation.
              cy.get('[data-cy=needs-confirming-row]').first().find('[data-cy=needs-confirming-message]').click()
              cy.location('pathname').should('eq', '/inbox')
              cy.location('search').should('contain', `open=${fiable.id}`)
            })
          })
        })
      })
    })
  })
})
