// Reports > Commissions: an owner sets a practitioner's pay plan, and the
// month's figures turn into what they earned. The arithmetic and the tier
// modes are unit-tested (tests/unit/pay-plan.test.ts); this pins the page to
// real rows -- attribution, receipts only, first visits.

// The 10th of last month at 10:00, and of the month before.
const lastMonth = (day: number, monthsBack = 1) => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsBack)
  d.setDate(day)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

describe('Commissions report', () => {
  it("turns last month's visits and payments into pay, from the plan set here", () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (first: string) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Comisión', defaultPractitionerId: account.teamMemberId })
      const visit = (patientId: string, startsAt: string) =>
        cy.task<{ id: string }>('db:createAppointment', { accountId: account.accountId, clinicId: account.clinicId, patientId, practitionerId: account.teamMemberId, startsAt, status: 'completed' })

      patient('Nueva').then((nueva) => {
        patient('Habitual').then((habitual) => {
          // Two visits from a first-time patient, one paid by card on its invoice.
          visit(nueva.id, lastMonth(10)).then((first) => {
            cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: nueva.id, totalCents: 5000, status: 'paid', appointmentId: first.id }).then((inv) => {
              cy.task('db:createPayment', { accountId: account.accountId, invoiceId: inv.id, amountCents: 5000, method: 'card', paidAt: lastMonth(10) })
            })
          })
          visit(nueva.id, lastMonth(17))
          // Money with no visit behind it counts to the patient's practitioner;
          // spent credit is not money in.
          cy.task('db:createPayment', { accountId: account.accountId, patientId: nueva.id, amountCents: 3000, method: 'cash', paidAt: lastMonth(17) })
          cy.task('db:createPayment', { accountId: account.accountId, patientId: nueva.id, amountCents: 2000, method: 'credit', paidAt: lastMonth(17) })
          // A returning patient: their visit counts, they are not new.
          visit(habitual.id, lastMonth(10, 2))
          visit(habitual.id, lastMonth(20))

          cy.login(account.email, account.password)
          cy.visit('/reports')
          cy.contains('a', 'Commissions').should('have.attr', 'href', '/reports/commissions')
          cy.visit('/reports/commissions')
          cy.get('[data-cy=commissions]').should('have.attr', 'data-ready', 'true')
          cy.get('[data-cy=commissions-row]').first().as('row')
          cy.get('@row').should('contain.text', '3').and('contain.text', 'No pay plan')

          // 35 % of payments, 10 € a visit -- 12 € once they reach 3 visits.
          cy.get('@row').find('[data-cy=commissions-edit]').click()
          cy.get('[data-cy=pay-payments-pct]').type('35')
          cy.get('[data-cy=pay-visit]').type('10')
          cy.get('[data-cy=pay-tier-add]').click()
          cy.get('[data-cy=pay-tier-from]').type('3')
          cy.get('[data-cy=pay-tier-amount]').type('12')
          cy.get('[data-cy=pay-mode-reached]').check()
          cy.get('[data-cy=pay-save]').click()
          cy.get('[data-cy=pay-plan-editor]').should('not.exist')

          // 3 × 12 € + 35 % × 80 € = 36 € + 28 €.
          cy.get('[data-cy=commissions-earned]').first().invoke('text').should('match', /64,00/)
          cy.get('[data-cy=commissions-row]').first().click()
          cy.get('[data-cy=commissions-detail]').should('contain.text', '3 × 12,00').and('contain.text', '35 % × 80,00')
          cy.get('[data-cy=commissions-total]').invoke('text').should('match', /64,00/)
        })
      })
    })
  })
})
