// A payment written down after the day it was taken lands on that day.
//
// The desk sometimes records money late -- a visit nobody charged for at the
// time, settled later. Every payment used to be stamped with the moment it
// was typed in, so it showed up in today's takings and today's cash shift
// rather than on the day the money came in. The payment panel now asks for
// the date, defaulting to today.
function localDate(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('A payment taken on an earlier day', () => {
  it('is recorded on the date the desk gives, and never on a future one', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lola', lastName: 'Latepay' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // See payment-records-who-took-it: the invoice has to be on screen
        // before the panel opens, or it opens with nothing selected.
        cy.contains('INV-').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.get('[data-cy=take-payment-date]').should('have.value', localDate(0))

        // Money cannot have come in tomorrow.
        cy.get('[data-cy=take-payment-date]').clear().type(localDate(1))
        cy.contains('button', 'Record payment').click()
        cy.contains('The payment date cannot be in the future.').should('be.visible')
        cy.task('db:paymentsFor', { patientId: patient.id }).should('have.length', 0)

        const earlier = localDate(-12)
        cy.get('[data-cy=take-payment-date]').clear().type(earlier)
        cy.contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one payment').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(4400)
          const paidAt = new Date(rows[0].paid_at)
          const paidOn = `${paidAt.getFullYear()}-${String(paidAt.getMonth() + 1).padStart(2, '0')}-${String(paidAt.getDate()).padStart(2, '0')}`
          expect(paidOn, 'stamped on the day the money came in').to.eq(earlier)
        })
      })
    })
  })
})
