// The registro de facturación: every factura leaves a record, and the records
// are chained.
//
// This is what RD 1007/2023 is actually about. Each record carries the huella
// of the one before it, so an invoice removed or altered after the fact breaks
// every record that followed -- the tampering is visible without anyone having
// kept a separate copy.
//
// Nothing here is sent to the AEAT. The huella formula is versioned on each
// row (see the migration) precisely because its exact byte layout is not yet
// confirmed against AEAT's specification document, and the chain is rebuilt
// wholesale if it turns out to differ.
describe('The registro de facturación', () => {
  it('writes a record for every factura, chained to the one before it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Cadena', lastName: 'Uno' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono A', sessionCount: 4, priceCents: 20000 })
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono B', sessionCount: 4, priceCents: 30000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('select', 'Sell a package').should('exist').select('Bono A (4, 200,00 €)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.contains('select', 'Sell a package').select('Bono B (4, 300,00 €)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          expect(records, 'one record per factura').to.have.length(2)

          const [first, second] = records
          // The first record in an account's chain has nothing before it.
          expect(first.previous_huella, 'the chain starts somewhere').to.eq(null)
          expect(first.huella).to.match(/^[0-9A-F]{64}$/)

          // And the second is welded to the first. This is the whole property:
          // the second record cannot be recomputed without the first.
          expect(second.previous_huella, 'each record carries its predecessor').to.eq(first.huella)
          expect(second.huella).to.match(/^[0-9A-F]{64}$/)
          expect(second.huella).to.not.eq(first.huella)

          // A bono is a full invoice, so F1 -- AEAT's code, not ours.
          expect(first.invoice_type).to.eq('F1')
          expect(first.importe_total_cents).to.eq(20000)
          expect(second.importe_total_cents).to.eq(30000)

          // Exempt, so no cuota reaches the record either.
          expect(first.cuota_total_cents).to.eq(0)

          // Which formula produced this row, so a chain built under a
          // superseded one can be found and rebuilt. It has to name the
          // formula that actually ran: new records once went on claiming the
          // draft after the draft had been replaced.
          expect(first.huella_spec_version).to.eq('aeat-0.1.2')
        })
      })
    })
  })

  it('refuses to let a record be altered or removed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Intacto', lastName: 'Dos' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono C', sessionCount: 4, priceCents: 15000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono C (4, 150,00 €)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          // Attempted with the service role -- the key the app itself uses. A
          // guarantee that only holds for anon traffic is not a guarantee.
          cy.task('db:tryMutateFacturaRecord', { id: records[0].id }).then((result: any) => {
            expect(result.updateBlocked, 'a record may not be rewritten').to.be.true
            expect(result.deleteBlocked, 'a record may not be deleted').to.be.true
            expect(result.updateMessage).to.contain('append-only')
          })

          // And it is genuinely untouched, not merely reported as such.
          cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((after: any) => {
            expect(after).to.have.length(1)
            expect(after[0].huella).to.eq(records[0].huella)
          })
        })
      })
    })
  })
})
