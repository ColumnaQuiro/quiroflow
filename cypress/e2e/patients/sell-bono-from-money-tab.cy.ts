// Selling a bono from the patient's Money tab. The sale form sat at the foot
// of the Bonos card, under every bono the patient had ever had, and the only
// buttons at the top were Cobrar and Vender producto -- which opens the
// product catalogue, empty in a clinic that sells no products. Reception
// looked there for "sell a bono" and concluded it could not be done (19 Nov).

describe('Selling a bono from the Money tab', () => {
  it('has "Sell bono" beside Cobrar, above the bonos already held, and no "Sell product" without products', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 12', sessionCount: 12, priceCents: 52800 })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mona', lastName: 'Moneytab' }).then((patient: any) => {
        cy.task('db:createPackagePurchase', { accountId: account.accountId, patientId: patient.id, packageName: 'Bono 10', sessionsTotal: 10, sessionsUsed: 10, priceCents: 46000 })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=money`)

        cy.get('[data-cy=sell-bono-open]', { timeout: 20000 }).should('contain.text', 'Sell bono')
        // No product has been set up, so the catalogue's button is not offered.
        cy.get('[data-cy=sell-product-open]').should('not.exist')

        // The sale comes before the bonos already held, not after them.
        cy.get('[data-cy=bono-card]').should('have.length', 1)
        cy.get('[data-cy=sell-package-form]').then(($form) => {
          cy.get('[data-cy=bono-card]').first().then(($card) => {
            expect($form[0].compareDocumentPosition($card[0]) & Node.DOCUMENT_POSITION_FOLLOWING, 'form before the cards').to.be.greaterThan(0)
          })
        })

        cy.get('[data-cy=sell-bono-open]').click()
        cy.focused().should('have.attr', 'data-cy', 'sell-package-select')
        cy.get('[data-cy=sell-package-select] option').contains('Bono 12').should('exist')
      })
    })
  })
})
