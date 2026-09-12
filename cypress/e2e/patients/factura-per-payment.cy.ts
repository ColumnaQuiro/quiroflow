// The fiscal document follows the money, not the visit.
//
// A patient handing over €528 for a bono used to receive nothing, and then
// twelve documents over the following months for visits they had already paid
// for. For a prepayment the obligation arises when the money is received --
// the one moment that produced no paperwork.
//
// So: one factura per payment, describing what the money bought.
describe('A factura for each payment', () => {
  it('describes a bono instalment as the share of the bono it buys', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pia', lastName: 'Prepay' }).then((patient: any) => {
        // A €528 / 12-session bono, half of it paid now.
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, €528.00)')
        cy.get('input[type="number"]').last().clear().type('264')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one factura for the one payment').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(26400)
          // Half the money buys half the sessions, and the document says so.
          expect(rows[0].description).to.contain('Bono 12')
          expect(rows[0].description).to.contain('€264.00 of €528.00')
          expect(rows[0].description).to.contain('6 of 12 sessions')
          // A bono is always a full invoice: it is over the simplified
          // threshold and the patient is buying a course of treatment.
          expect(rows[0].kind).to.eq('full')
          expect(rows[0].number).to.match(/^F-\d{4}-\d{4}$/)
          // Left to resolve from the patient record, so a NIF collected next
          // week appears on this document without reissuing it.
          expect(rows[0].recipient_nif, 'recipient resolves live until frozen').to.eq(null)
        })
      })
    })
  })

  it('issues nothing for a credit payment, which was documented when the credit was paid', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cleo', lastName: 'Credituser' }).then((patient: any) => {
        // €100 of credit sitting on the account, and a €55 charge to spend it on.
        cy.task('db:createAccountCredit', { accountId: account.accountId, patientId: patient.id, amountCents: 10000, reason: 'Prepaid' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5500, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // Wait for the ledger to load: the take-payment form is gated on there
        // being an unpaid invoice, and clicking before they arrive opens an
        // empty panel.
        cy.contains('€55.00').should('be.visible')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        cy.get('@form').find('select').last().select('Credit on account (€100.00 available)')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'spending credit is not a new fiscal event').to.have.length(0)
        })
      })
    })
  })

  it('numbers the series without gaps or repeats', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nina', lastName: 'Numbered' }).then((patient: any) => {
        const seen: string[] = []
        const year = new Date().getFullYear()
        cy.task('db:nextFacturaNumber', { accountId: account.accountId }).then((a: any) => {
          expect(a).to.eq(`F-${year}-0001`)
          seen.push(a)
          cy.task('db:nextFacturaNumber', { accountId: account.accountId }).then((b: any) => {
            expect(b).to.eq(`F-${year}-0002`)
            seen.push(b)
            expect(new Set(seen).size).to.eq(2)
          })
        })
      })
    })
  })
})
