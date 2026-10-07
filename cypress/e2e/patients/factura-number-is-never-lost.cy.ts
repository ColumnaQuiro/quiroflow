// A factura's number used to be taken by one call (next_factura_number) and
// the factura written by another. When the write failed, the number was gone
// for good: a gap in a correlative VeriFactu series, which is exactly what the
// series exists to rule out -- and the screen said nothing, because the
// failure was returned as null and dropped.
//
// issue_factura takes the number and writes the factura in one transaction, so
// a refused write gives the number back; and a failure is now said out loud.
function sequenceOf(accountId: string) {
  return cy
    .task<any[]>('db:selectRows', { table: 'factura_number_sequences', columns: 'series, next_number', match: { account_id: accountId, series: 'F' } })
    .then((rows) => rows[0]?.next_number ?? 1)
}

describe('Issuing a factura', () => {
  it('gives the number back when the factura cannot be written', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Gap', lastName: 'Less' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 5000, method: 'cash' }).then((paid: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 3000, method: 'cash' }).then((second: any) => {
            const args = (paymentId: string, amount: number) => ({
              p_account_id: account.accountId,
              p_patient_id: patient.id,
              p_payment_id: paymentId,
              p_kind: 'simplified',
              p_description: 'Consulta',
              p_amount_cents: amount,
              p_tax_base_cents: amount,
              p_tax_rate_bp: 0,
              p_tax_amount_cents: 0,
              p_tax_exemption_code: 'E1',
            })

            // The first one, as the signed-in member at the desk.
            cy.task<any>('db:callRpcAs', { email: account.email, password: account.password, fn: 'issue_factura', args: args(paid.id, 5000) }).then((first) => {
              expect(first.error, 'issued').to.eq(null)
              const issued = Array.isArray(first.data) ? first.data[0] : first.data
              expect(issued.number).to.match(/-0001$/)
            })
            sequenceOf(account.accountId).should('eq', 2)

            // A second factura for the same payment is refused by the
            // database (one factura per payment) -- and the number it was
            // about to take is not spent.
            cy.task<any>('db:callRpcAs', { email: account.email, password: account.password, fn: 'issue_factura', args: args(paid.id, 5000) }).then((dup) => {
              expect(dup.error, 'refused').to.not.eq(null)
            })
            sequenceOf(account.accountId).should('eq', 2)

            // So the next one is 0002, with nothing missing in between.
            cy.task<any>('db:callRpcAs', { email: account.email, password: account.password, fn: 'issue_factura', args: args(second.id, 3000) }).then((next) => {
              expect(next.error).to.eq(null)
              const issued = Array.isArray(next.data) ? next.data[0] : next.data
              expect(issued.number).to.match(/-0002$/)
            })
            cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
              expect(rows.map((r: any) => r.number.slice(-4)).sort()).to.deep.eq(['0001', '0002'])
            })
          })
        })
      })
    })
  })

  it('says so on screen when the factura could not be issued', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Loud', lastName: 'Failure' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })

        // Whichever call the screen numbers the factura with, it fails.
        cy.intercept('POST', /\/rest\/v1\/rpc\/(next_factura_number|issue_factura)/, {
          statusCode: 500,
          body: { code: 'XX000', message: 'numbering unavailable' },
        }).as('numbering')

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, 528,00 €)')
        cy.get('input[type="number"]').last().clear().type('264')
        cy.contains('button', /^Sell$/).click()
        cy.wait('@numbering')

        // The money was taken -- that must never be undone over a document --
        // but reception is told the factura is missing.
        cy.contains('factura could not be issued').should('be.visible')
        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'the payment stands').to.have.length(1)
        })
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'no factura').to.have.length(0)
        })
      })
    })
  })
})
