// "Hoy de un vistazo" on the calendar shows what the clinic collected and
// invoiced today, by the day sheet's rules: spent credit is not money, a
// voided invoice and its payment do not count, an unpaid invoice is invoiced
// but not collected.

describe("Today's takings on the calendar", () => {
  it('shows collected and invoiced today, by the day sheet rules', () => {
    cy.seedStaffAccount().then((account) => {
      const a = account.accountId
      const at = new Date()
      at.setHours(Math.max(0, at.getHours() - 1), 0, 0, 0)
      cy.task<{ id: string }>('db:createPatient', { accountId: a, clinicId: account.clinicId, firstName: 'Sara', lastName: 'Gómez' }).then((patient) => {
        cy.task<{ id: string }>('db:createAppointment', { accountId: a, clinicId: account.clinicId, patientId: patient.id, practitionerId: account.teamMemberId, startsAt: at.toISOString(), status: 'completed' }).then((visit) => {
          // A visit charged 45 € and paid by card: collected and invoiced.
          cy.task<{ id: string }>('db:createInvoice', { accountId: a, patientId: patient.id, totalCents: 4500, status: 'paid', appointmentId: visit.id }).then((inv) => {
            cy.task('db:createPayment', { accountId: a, invoiceId: inv.id, amountCents: 4500, method: 'card' })
          })
        })
        // 50 € invoiced, not paid yet: invoiced only.
        cy.task('db:createInvoice', { accountId: a, patientId: patient.id, totalCents: 5000, status: 'unpaid' })
        // Credit spent today: not money arriving.
        cy.task('db:createPayment', { accountId: a, patientId: patient.id, amountCents: 2000, method: 'credit' })
        // A voided charge and its cash: neither counts.
        cy.task<{ id: string }>('db:createInvoice', { accountId: a, patientId: patient.id, totalCents: 3000, status: 'void' }).then((inv) => {
          cy.task('db:createPayment', { accountId: a, invoiceId: inv.id, amountCents: 3000, method: 'cash' })
        })
      })

      cy.login(account.email, account.password)
      cy.visit('/calendar')
      cy.get('[data-cy="glance-collected"]', { timeout: 20000 }).should('contain', '45,00')
      cy.get('[data-cy="glance-invoiced"]').should('contain', '95,00')
      cy.get('[data-cy="glance-takings"]').should('have.attr', 'href', '/reports/daily-transactions')
    })
  })
})
