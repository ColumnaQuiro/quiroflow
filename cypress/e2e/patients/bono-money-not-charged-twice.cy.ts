// A bono sold here used to be charged twice.
//
// Selling one raised an invoice for its full price, and then every visit
// drawn from it raised its own charge as well. Alonso Varela was invoiced
// €528 for the bono and €44 for the visit he took from it; run that bono out
// and it is €1,056 charged for €528 of sessions.
//
// The 518 bonos migrated from PracticeHub never had a sale invoice and have
// been right all along: the money sits on the account and each visit's charge
// draws it down. This is the native sale doing the same, so there is one
// model rather than two.
describe('Buying a bono', () => {
  it('takes the money without charging for the bono as well', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Nodouble' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('select', 'Sell a package').should('exist').select('Bono 12 (12, 528,00 €)')
        cy.get('input[type="number"]').last().clear().type('264')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        // No charge was raised for the bono itself. The money is a payment on
        // the account, and the debt lives on the bono.
        cy.contains('INV-').should('not.exist')
        cy.contains('264,00 € owed').should('be.visible')
        cy.contains('264,00 € paid of 528,00 €').scrollIntoView().should('be.visible')

        // The payment still produces its factura -- that is the fiscal
        // document for a bono, and the only one.
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one factura for the one payment').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(26400)
          expect(rows[0].description).to.contain('€264.00 of €528.00')
        })

        // Collecting the rest goes straight onto the bono, no invoice in sight.
        // The bono's own button, not the account-level one at the top of the
        // tab -- only this one carries the ellipsis.
        cy.contains('button', 'Take payment\u2026').click()
        cy.contains('button', 'Record payment').click()
        cy.contains('Recording…').should('not.exist')

        // Scrolled to first: recording the payment can leave the Money tab
        // scrolled down to the ledger, and text above a scroll box's view
        // reads as not visible even though it is on the page.
        cy.contains('528,00 € paid in full').scrollIntoView().should('be.visible')
        cy.contains('INV-').should('not.exist')
        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'a factura for each payment').to.have.length(2)
        })
      })
    })
  })

  it('issues a factura for money taken as credit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Caja', lastName: 'Credito' }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        // €150 cash handed over and put on account. This used to write the
        // credit row alone: no payment, no factura, and the money never
        // reached the takings -- Alonso Varela's €150 came in this way.
        cy.contains('button', 'Add credit').click()
        cy.get('input[type="number"]').first().clear().type('150')
        // The panel's own submit carries the same words as the button that
        // opened it, so take the last one.
        cy.get('button:contains("Add credit")').last().click()
        cy.contains('button', 'Adding…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'money in, document out').to.have.length(1)
          expect(rows[0].amount_cents).to.eq(15000)
          expect(rows[0].description).to.contain('Saldo a cuenta')
        })
      })
    })
  })
})
