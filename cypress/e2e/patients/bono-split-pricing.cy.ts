// A bono priced by how many plazos it is paid in.
//
// "Bono 10 sesiones" costs 500 EUR paid at once, 2 x 250 EUR, or 3 x 180 EUR
// (540 EUR in all): each option is priced by the clinic, and a split may cost
// more than paying up front. A sale records the option, its total becomes the
// bono's price, each plazo gets its own factura, and a plazo is only a debt
// once the sessions already paid for have been used -- until then it is still
// to come, and Debtors leaves it alone.
describe('Bonos priced by plazos', () => {
  it('lets the clinic price each way of paying a bono in Settings', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 10 sesiones', sessionCount: 10, priceCents: 50000 })
      cy.login(account.email, account.password)
      cy.visit('/settings/packages')

      cy.contains('[data-cy="package-card"]', 'Bono 10 sesiones').find('[data-cy="package-edit"]').click()
      // A new option starts at the price split evenly...
      cy.get('[data-cy="package-option-add"]').click()
      cy.get('[data-cy="package-option-row"]').eq(0).within(() => {
        cy.get('[data-cy="package-option-installments"]').should('have.value', '2')
        cy.get('[data-cy="package-option-amount"]').should('have.value', '250,00')
      })
      // ...and is priced freely: three plazos costing more than paying at once.
      cy.get('[data-cy="package-option-add"]').click()
      cy.get('[data-cy="package-option-row"]').eq(1).within(() => {
        cy.get('[data-cy="package-option-installments"]').clear().type('3')
        cy.get('[data-cy="package-option-amount"]').clear().type('180,00')
        cy.get('[data-cy="package-option-total"]').should('contain', '540,00')
      })
      cy.get('[data-cy="package-save"]').click()
      cy.get('[data-cy="package-form"]').should('not.exist')

      cy.contains('[data-cy="package-card"]', 'Bono 10 sesiones').find('[data-cy="package-installment-option"]').should('have.length', 2).and('contain', '540,00')
      cy.task('db:selectRows', { table: 'packages', columns: 'price_cents, installment_options', match: { account_id: account.accountId } }).then((rows: any) => {
        expect(rows[0].price_cents).to.eq(50000)
        expect(rows[0].installment_options).to.deep.eq([
          { installments: 2, installment_cents: 25000 },
          { installments: 3, installment_cents: 18000 },
        ])
      })

      // Two options with the same number of plazos are refused, not saved.
      cy.contains('[data-cy="package-card"]', 'Bono 10 sesiones').find('[data-cy="package-edit"]').click()
      cy.get('[data-cy="package-option-row"]').eq(1).find('[data-cy="package-option-installments"]').clear().type('2')
      cy.get('[data-cy="package-save"]').click()
      cy.get('[data-cy="package-form"]').should('contain', 'Two options have the same number of plazos')
    })
  })

  it('sells under the option chosen, at its price, with a factura for the first plazo', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Tres', lastName: 'Plazos' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', {
          accountId: account.accountId,
          name: 'Bono 10',
          sessionCount: 10,
          priceCents: 50000,
          installmentOptions: [
            { installments: 2, installmentCents: 25000 },
            { installments: 3, installmentCents: 18000 },
          ],
        })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.get('[data-cy="sell-package-select"]').should('exist').select('Bono 10 (10, 500,00 €)')
        cy.get('[data-cy="sell-package-installments"]').select('3 plazos of 180,00 € · 540,00 €')
        // What is taken now is the first plazo, not the whole price.
        cy.contains('label', 'Paid now (€)').parent().find('input').should('have.value', '180.00')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:selectRows', { table: 'package_purchases', columns: 'price_cents, owed_cents, installments, installment_cents', match: { patient_id: patient.id } }).then((rows: any) => {
          expect(rows).to.have.length(1)
          expect(rows[0]).to.deep.eq({ price_cents: 54000, owed_cents: 54000, installments: 3, installment_cents: 18000 })
        })
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one factura for the one plazo').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(18000)
          expect(rows[0].description).to.contain('plazo 1 de 3: 180,00 € de 540,00 €')
        })

        // Nothing is due until the three sessions the first plazo paid for
        // are used, and the card says when the next one is.
        cy.contains('[data-cy="bono-card"]', 'Bono 10').within(() => {
          cy.get('[data-cy="bono-up-to-date"]').should('be.visible')
          cy.get('[data-cy="bono-owed"]').should('not.exist')
          cy.get('[data-cy="bono-installments"]').should('contain', '1 of 3 plazos paid').and('contain', 'after session 3')
          // Each session is worth the option's total over its sessions.
          cy.contains('worth 540,00 €').should('exist')
        })
      })
    })
  })

  it('owes the next plazo once the sessions paid for are used, and names it on its factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dos', lastName: 'Plazos' }).then((patient: any) => {
        // 2 x 250 on a 10-session bono, the first plazo paid, five sessions used.
        cy.task('db:createPackagePurchase', {
          accountId: account.accountId,
          patientId: patient.id,
          packageName: 'Bono 10',
          sessionsTotal: 10,
          sessionsUsed: 5,
          priceCents: 50000,
          owedCents: 50000,
          installments: 2,
          installmentCents: 25000,
        }).then((bono: any) => {
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, packagePurchaseId: bono.id, amountCents: 25000, method: 'card', purpose: 'bono' })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          cy.contains('[data-cy="bono-card"]', 'Bono 10').within(() => {
            cy.get('[data-cy="bono-owed"]').should('contain', '250,00 €')
            cy.contains('button', 'Take payment').click()
            cy.get('input[type="number"]').should('have.value', '250.00')
            cy.contains('button', 'Record payment').click()
            cy.get('[data-cy="bono-owed"]').should('not.exist')
          })
          cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
            expect(rows).to.have.length(1)
            expect(rows[0].description).to.contain('plazo 2 de 2: 250,00 € de 500,00 €')
          })
        })
      })
    })
  })

  it('lists only the plazos already due on Debtors', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Aun', lastName: 'Novence' }).then((early: any) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ya', lastName: 'Vence' }).then((due: any) => {
          // Both on a 2 x 250 bono with the first plazo paid. Two sessions used
          // leaves the second plazo still to come; six makes it due.
          const seed = (patientId: string, sessionsUsed: number) =>
            cy
              .task('db:createPackagePurchase', {
                accountId: account.accountId,
                patientId,
                packageName: 'Bono 10',
                sessionsTotal: 10,
                sessionsUsed,
                priceCents: 50000,
                owedCents: 50000,
                installments: 2,
                installmentCents: 25000,
              })
              .then((bono: any) => cy.task('db:createPayment', { accountId: account.accountId, patientId, packagePurchaseId: bono.id, amountCents: 25000, method: 'cash', purpose: 'bono' }))
          seed(early.id, 2)
          seed(due.id, 6)

          cy.login(account.email, account.password)
          cy.visit('/reports/debtors')

          cy.contains('tr', 'Ya Vence').should('contain', '250,00 €')
          cy.contains('tr', 'Aun Novence').should('not.exist')
          cy.contains('Total outstanding across 1 purchase(s)').should('exist')
        })
      })
    })
  })
})
