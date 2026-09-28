// Settings > Receipt Settings > Factura numbering: a clinic picks its own
// prefixes and where this year's count continues from, e.g. the next number
// of the system it is leaving. The count only moves forward.
describe('Factura numbering', () => {
  // The series year is Madrid's, as next_factura_number computes it.
  const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date())

  it('lets a clinic set its prefix and continue its series from a later number', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('POST', '**/rest/v1/rpc/set_factura_numbering').as('saveNumbering')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoice-settings')

      // A new clinic starts at F-<year>-0001 and R-<year>-0001.
      cy.get('[data-cy="factura-preview"]').should('have.text', `F-${year}-0001`)
      cy.get('[data-cy="rectificativa-preview"]').should('have.text', `R-${year}-0001`)

      cy.get('[data-cy="factura-prefix"]').clear().type('FAC')
      cy.get('[data-cy="factura-next"]').clear().type('89')
      cy.get('[data-cy="factura-preview"]').should('have.text', `FAC-${year}-0089`)
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.wait('@saveNumbering').its('response.statusCode').should('eq', 200)

      // The next factura issued carries it.
      cy.task('db:nextFacturaNumber', { accountId: account.accountId }).should('eq', `FAC-${year}-0089`)

      // And the card now says 90, and refuses to go back below it.
      cy.reload()
      cy.get('[data-cy="factura-preview"]').should('have.text', `FAC-${year}-0090`)
      cy.get('[data-cy="factura-next"]').clear().type('50')
      cy.get('[data-cy="factura-numbering-error"]').should('be.visible')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.get('@saveNumbering.all').should('have.length', 1)
    })
  })

  it('refuses the same prefix for facturas and rectificativas', () => {
    // Both series share one unique index on the number, so equal prefixes
    // would hand out the same number twice. The database refuses it as well
    // (accounts_factura_prefixes_differ); this is the page saying so first.
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/invoice-settings')
      cy.get('[data-cy="rectificativa-prefix"]').clear().type('f')
      cy.get('[data-cy="factura-numbering-error"]').should('contain', 'different prefixes')
    })
  })
})
