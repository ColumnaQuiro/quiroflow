// The database supplies a factura's tax when the caller does not.
//
// tax_base_cents is NOT NULL, which is right -- a factura with no base is not
// a document anyone may hand a patient. But it created an ordering trap:
// apply that migration before the release that populates the column, and the
// deployed app violates the constraint on every insert. useFacturas() swallows
// errors so money is never blocked, so facturas would have stopped being
// issued with nothing to show for it.
//
// This pins the fix by inserting exactly the way the previous release did --
// no tax columns at all -- and asserting the row still comes out complete.
describe('A factura fills in its own tax', () => {
  it('completes an insert that names no tax at all, the way the old release did', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Vieja', lastName: 'Version' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4500, method: 'cash' }).then((payment: any) => {
          cy.task('db:createFacturaWithoutTax', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F-2026-9001',
            description: 'Consulta',
            amountCents: 4500,
          }).then((factura: any) => {
            // Exempt account, so the whole amount is the base and there is no
            // cuota -- the same answer facturaTaxFor() gives in the app.
            expect(factura.tax_base_cents, 'the database supplied the base').to.eq(4500)
            expect(factura.tax_amount_cents).to.eq(0)
            expect(factura.tax_rate_bp).to.eq(0)
            expect(factura.tax_exemption_code).to.eq('E1')
          })
        })
      })
    })
  })

  it('still records it in the chain, with the cuota the trigger supplied', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cadena', lastName: 'Vieja' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 8000, method: 'cash' }).then((payment: any) => {
          cy.task('db:createFacturaWithoutTax', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F-2026-9002',
            description: 'Consulta',
            amountCents: 8000,
          }).then(() => {
            // The registro is written by an AFTER INSERT trigger that reads
            // the tax columns, so it only works if the BEFORE trigger ran
            // first. Ordering between the two is the thing being checked.
            cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
              expect(records).to.have.length(1)
              expect(records[0].importe_total_cents).to.eq(8000)
              expect(records[0].cuota_total_cents, 'the trigger had run by then').to.eq(0)
              expect(records[0].huella).to.match(/^[0-9A-F]{64}$/)
            })
          })
        })
      })
    })
  })
})
