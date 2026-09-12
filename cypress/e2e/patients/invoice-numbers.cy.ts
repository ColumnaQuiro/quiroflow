// Invoice numbers came from `select count(*) from invoices` plus one, which
// is not a sequence: deleting an invoice frees its number for the next one.
// Seven numbers on the live account are held by two invoices each because of
// it (INV-3260, 3263, 3290, 3291, 3292, 3302, 3388) -- and AEAT requires the
// series to be sequential and unrepeated. next_invoice_number() replaces the
// count with a counter that only moves forward.
//
// No browser here on purpose: the property under test is the allocator's,
// and every UI path just calls it.
describe('Invoice numbering', () => {
  it('never hands out a number twice, even after the invoice is deleted', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Numbers' }).then((patient: any) => {
        const seen: string[] = []

        cy.task('db:nextInvoiceNumber', { accountId: account.accountId }).then((first: any) => {
          expect(first, 'a fresh account starts its own series').to.eq('INV-0001')
          seen.push(first)

          // Raise it, then delete it -- what usePackageSession() does to the
          // invoice on a visit that turns out to be covered by a bono.
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, invoiceNumber: first }).then((invoice: any) => {
            cy.task('db:deleteInvoice', { invoiceId: invoice.id })

            cy.task('db:nextInvoiceNumber', { accountId: account.accountId }).then((second: any) => {
              expect(second, 'the freed number is not reissued').to.not.eq(first)
              expect(second).to.eq('INV-0002')
              seen.push(second)

              // Refunds are their own series: taking one must not consume or
              // skip a number in the invoice series.
              cy.task('db:nextInvoiceNumber', { accountId: account.accountId, prefix: 'REF-' }).then((refund: any) => {
                expect(refund).to.eq('REF-0001')

                cy.task('db:nextInvoiceNumber', { accountId: account.accountId }).then((third: any) => {
                  expect(third, 'the invoice series carried on undisturbed').to.eq('INV-0003')
                  seen.push(third)
                  expect(new Set(seen).size, 'every number distinct').to.eq(seen.length)
                })
              })
            })
          })
        })
      })
    })
  })
})
