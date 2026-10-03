// The cash shift lists the visits completed today whose charge is still
// open. A visit can carry two receipts -- one voided and raised again -- and
// the list used to judge it by whichever receipt the query happened to
// return last: an open receipt read before its voided twin dropped the visit
// off the list as if nothing were owed.

function todayAt(h: number) {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

describe('The cash shift, a visit with a voided receipt', () => {
  it('judges the visit by the receipt that stands, not the voided one', () => {
    cy.seedStaffAccount().then((account) => {
      const visit = (first: string, receipts: string[]) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Caja' }).then((p) =>
          cy
            .task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId: p.id, practitionerId: account.teamMemberId, startsAt: todayAt(0), status: 'completed' })
            .then((appt) => {
              receipts.forEach((status, i) =>
                cy.task('db:createInvoice', { accountId: account.accountId, patientId: p.id, appointmentId: appt.id, totalCents: 4500, status, invoiceNumber: `CS-${first}-${i}-${Date.now()}` }),
              )
            }),
        )
      // Raised again after a void: the open one is what is owed. Inserted
      // first, so the void is the row read last.
      visit('Rehecha', ['unpaid', 'void'])
      // Paid, with a voided first attempt beside it: settled.
      visit('Pagada', ['paid', 'void'])

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.contains('button', 'Cash Shift').click()
      cy.contains('li', 'Rehecha Caja').should('be.visible')
      cy.contains('li', 'Pagada Caja').should('not.exist')
    })
  })
})
