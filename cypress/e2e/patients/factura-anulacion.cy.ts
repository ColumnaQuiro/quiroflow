// A factura that should never have been issued is annulled with a VERI*FACTU
// registro de anulación (annul_factura), not a rectificativa: the AEAT's own
// procedure for an invoice that should not exist. The number stays on the
// series, marked annulled; nothing negative is issued; and the anulación
// joins the huella chain, which still verifies.
//
// The rectificativa route beside it is factura-survives-payment-deletion.cy.ts.
describe('Annulling a factura issued in error', () => {
  it('appends a registro de anulación, marks the factura, and keeps the chain whole', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Anulada' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // A payment, which issues the factura, then removed as taken in error.
        cy.contains('INV-').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')
        cy.contains('tr', 'Payment — cash').click()
        cy.contains('button', 'Remove payment').click()
        cy.contains('tr', 'Payment — cash').should('not.exist')

        cy.contains('button', 'Facturas & receipts').click()
        cy.contains('payment removed').should('be.visible')

        // The dialog offers the anulación first, already chosen.
        cy.get('[data-cy="factura-annul"]').click()
        cy.get('[data-cy="factura-annul-mode-anulacion"]').should('be.checked')
        cy.get('[data-cy="factura-annul-reason"]').type('taken twice by mistake')
        cy.contains('button', 'Annul factura').click()
        cy.contains('payment removed').should('not.exist')
        cy.contains('annulled').should('be.visible')
        cy.get('[data-cy="factura-annul"]').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          // No rectificativa: the factura itself is annulled.
          expect(rows, 'only the original factura').to.have.length(1)
          const [factura] = rows
          expect(factura.annulled_at, 'marked annulled').to.be.a('string')
          expect(factura.annulment_reason).to.eq('taken twice by mistake')

          cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
            const mine = records.filter((r: any) => r.factura_id === factura.id)
            expect(mine.map((r: any) => r.record_type), 'its alta, then its anulación').to.deep.eq(['alta', 'anulacion'])
            const [alta, anulacion] = mine
            // Names the factura it annuls, exactly as the alta recorded it,
            // and chains to the record before it.
            expect(anulacion.serie_number).to.eq(alta.serie_number)
            expect(anulacion.issuer_nif).to.eq(alta.issuer_nif)
            expect(anulacion.importe_total_cents, 'an anulación carries no amount').to.eq(0)
            expect(anulacion.previous_huella).to.eq(records[records.length - 2].huella)
          })

          // The verifier recomputes the anulación with its own formula.
          cy.task('db:verifyFacturaChain', { accountId: account.accountId }).then((problems: any) => {
            expect(problems, 'the chain still verifies').to.deep.eq([])
          })

          // Only annul_factura() can mark a factura annulled -- not a direct
          // write, which would leave no anulación in the chain.
          cy.task('db:tryMarkFacturaAnnulled', { facturaId: factura.id }).then((r: any) => {
            expect(r.error).to.contain('annul_factura')
          })

          // The PDF says so.
          cy.request({ url: `/api/facturas/${factura.id}/pdf`, encoding: 'binary' }).then((res) => {
            cy.task<string[]>('pdf:text', { binary: res.body }).then((texts) => {
              expect(texts.join(' ')).to.contain('ANULADA')
            })
          })
        })

        // And nothing touched the money.
        cy.contains('REF-').should('not.exist')
      })
    })
  })
})
