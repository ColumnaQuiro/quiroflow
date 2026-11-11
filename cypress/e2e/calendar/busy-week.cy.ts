// A whole-clinic week holds hundreds of visits, and the calendar looks up
// their balances, bonos, payments and moves by id. As .in() filters those ids
// travelled in the URL, and past ~215 the gateway refused it with 414 --
// which the page used to read as "nothing found", so a busy week quietly
// lost every "Debe" and bono count. They now go in the body of one request
// (calendar_range_details); this holds that a week this size still gets its
// answer. 300 visits here, one per patient.

/** Monday of this week, local midnight. */
function thisMonday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

describe('A busy week', () => {
  it('still shows who owes when the week has more visits than one request can name', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ patientIds: string[] }>('db:seedBusyWeek', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        practitionerId: account.teamMemberId,
        weekStartIso: thisMonday().toISOString(),
        count: 300,
      }).then(({ patientIds }) => {
        // The last patient in the list is the one that owes: well past where
        // a single request's id list used to be cut off.
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patientIds[patientIds.length - 1], totalCents: 4500, status: 'unpaid' })
      })

      cy.intercept('POST', '**/rest/v1/rpc/calendar_range_details').as('details')
      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('select', 'Work week').should('have.value', 'workweek')

      // Every id of the week in the one request, and it is answered.
      cy.wait('@details').then((call) => {
        expect(call.request.body.p_appointment_ids).to.have.length.greaterThan(200)
        expect(call.response?.statusCode).to.eq(200)
      })
      cy.get('[data-cy=appt-block]').should('have.length.greaterThan', 200)
      // Week view shortens every name here to "B. Patient", so the debtor is
      // found by the one € dot in the week rather than by name.
      cy.get('[data-cy=appt-block] [data-cy=appt-block-owes]').should('have.length', 1)
      cy.get('[data-cy=day-counts]').should('contain.text', '1').and('contain.text', 'owe')
    })
  })
})
