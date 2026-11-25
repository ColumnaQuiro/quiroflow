// A bono sold at a special price. A clinic gave a patient a discount on a
// bono and asked how to sell it without her showing as owing the difference
// (25 Nov 2026): the sale always took the bono's own price, so paying the
// discounted amount left the discount on the bono as debt, and nothing could
// change a bono's price once it was sold.

describe('Selling a bono at a special price', () => {
  it('sells at the lower price, paid in full, and owes nothing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 10', sessionCount: 10, priceCents: 50000 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dana', lastName: 'Descuento' }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.get('[data-cy="sell-package-select"]').should('exist').select('Bono 10 (10, 500,00 €)')
        cy.get('[data-cy="sell-package-price"]').should('have.value', '500.00')
        cy.get('[data-cy="sell-package-discount-note"]').should('not.exist')

        // A higher price is not a discount: refused before it is sent.
        cy.get('[data-cy="sell-package-price"]').clear().type('600')
        cy.get('[data-cy="sell-package-discount-note"]').should('contain', 'at most 500,00')
        cy.contains('button', /^Sell$/).should('be.disabled')

        cy.get('[data-cy="sell-package-price"]').clear().type('450')
        cy.get('[data-cy="sell-package-discount-note"]').should('contain', 'Special price: 50,00 € off')
        // What is taken now follows the price.
        cy.contains('label', 'Paid now (€)').parent().find('input').should('have.value', '450')
        cy.contains('button', /^Sell$/).should('not.be.disabled').click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:selectRows', { table: 'package_purchases', columns: 'price_cents, owed_cents, installments', match: { patient_id: patient.id } }).then((rows: any) => {
          expect(rows).to.have.length(1)
          expect(rows[0]).to.deep.eq({ price_cents: 45000, owed_cents: 45000, installments: null })
        })
        cy.task('db:selectRows', { table: 'payments', columns: 'amount_cents, purpose', match: { patient_id: patient.id } }).then((rows: any) => {
          expect(rows).to.deep.eq([{ amount_cents: 45000, purpose: 'bono' }])
        })

        // Paid in full at its own price: nothing owed, and the bono is worth
        // what was paid for it, not its list price.
        cy.contains('[data-cy="bono-card"]', 'Bono 10').within(() => {
          cy.get('[data-cy="bono-owed"]').should('not.exist')
          cy.contains('worth 450,00 €').should('exist')
        })
      })
    })
  })

  it('offers no special price for a bono paid in plazos', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paula', lastName: 'Plazos' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', {
          accountId: account.accountId,
          name: 'Bono 10',
          sessionCount: 10,
          priceCents: 50000,
          installmentOptions: [{ installments: 2, installmentCents: 26000 }],
        })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.get('[data-cy="sell-package-select"]').should('exist').select('Bono 10 (10, 500,00 €)')
        cy.get('[data-cy="sell-package-price"]').should('be.visible')
        cy.get('[data-cy="sell-package-installments"]').select('2 plazos of 260,00 € · 520,00 €')
        cy.get('[data-cy="sell-package-price"]').should('not.exist')
      })
    })
  })
})
