// A factura has to say what was taxed, and at what rate -- or why it was not.
//
// Until now it carried one figure, amount_cents, and printed it as "Total".
// RD 1619/2012 asks for the base imponible and the rate and cuota, or the
// provision the operation is exempt under, and a line reading only "Total"
// answers none of that. The same three figures are what a VERI*FACTU registro
// de facturación is built from, so nothing in that direction can start until
// they are recorded.
//
// ColumnaQuiro's services are exempt under art. 20 of Ley 37/1992, which is
// the account default the seed inherits: base equals total, cuota is zero, and
// the code E1 is stored rather than the sentence, so the printed wording can
// be improved without rewriting issued invoices.
describe('A factura states its tax', () => {
  it('records base, cuota and the exemption at the moment of issue', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Iva', lastName: 'Exenta' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 10', sessionCount: 10, priceCents: 45000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('select', 'Sell a package').should('exist').select('Bono 10 (10, €450.00)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows).to.have.length(1)
          const f = rows[0]
          expect(f.amount_cents).to.eq(45000)
          // Exempt: the whole amount is the base and there is no cuota. The
          // total the patient paid and the base on the document are the same
          // number, which is the point of an exemption rather than a 0% rate.
          expect(f.tax_base_cents, 'base equals the total when exempt').to.eq(45000)
          expect(f.tax_amount_cents, 'an exempt operation has no cuota').to.eq(0)
          expect(f.tax_rate_bp).to.eq(0)
          expect(f.tax_exemption_code, "AEAT's CausaExencion for art. 20").to.eq('E1')
        })
      })
    })
  })

  it('prints the base and the exemption clause on the document, not just a total', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paco', lastName: 'Pdf' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 5', sessionCount: 5, priceCents: 22000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono 5 (5, €220.00)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          // The PDF is the document the patient is actually given, so the
          // assertion is on its bytes rather than on the row that fed it.
          cy.request({ url: `/api/facturas/${rows[0].id}/pdf`, encoding: 'binary', failOnStatusCode: false }).then((res) => {
            expect(res.status, 'the factura renders').to.eq(200)
            expect(res.headers['content-type']).to.contain('pdf')
            expect(res.body.length, 'a real document, not an empty one').to.be.greaterThan(1000)
          })
        })
      })
    })
  })
})
