// Informes > Gestoría (server/api/reports/gestoria-export.post.ts): the
// period's facturas summed by IVA rate on screen, and one ZIP with the
// libro registro de facturas expedidas, the IVA summary, the payments and the
// facturas' PDFs. Only for someone with billing and reports access -- not the Front Desk role.
describe('Gestoría export', () => {
  it('sums the period by IVA rate and hands over one ZIP with the book and the PDFs', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }[]>('db:insertRows', {
        table: 'services_products',
        rows: [
          { account_id: account.accountId, kind: 'product', name: 'Almohada cervical', price_cents: 3630, tax_rate: 21, stock_units: 5 },
          { account_id: account.accountId, kind: 'product', name: 'Magnesio', price_cents: 1100, tax_rate: 10, stock_units: 5 },
        ],
      }).then((products) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Gestoria' }).then((patient) => {
          cy.login(account.email, account.password)
          cy.visit('/reports/gestoria')
          cy.get('[data-cy=gestoria][data-ready=true]', { timeout: 20000 })
          // Two facturas this quarter: 21 % and 10 %.
          cy.request({ method: 'POST', url: '/api/products/sell', body: { patientId: patient.id, method: 'card', items: products.map((p) => ({ productId: p.id, quantity: 1 })) } }).its('body.sales').should('have.length', 2)
          cy.reload()
          cy.get('[data-cy=gestoria][data-ready=true]', { timeout: 20000 })
          cy.get('[data-cy=gestoria-count]').should('contain', '2 facturas')
          cy.get('[data-cy=gestoria-iva-line][data-key="rate:2100"]').should('contain', 'IVA 21 %').invoke('text').should('match', /30[.,]00/)
          cy.get('[data-cy=gestoria-iva-line][data-key="rate:1000"]').should('contain', 'IVA 10 %')
          cy.get('[data-cy=gestoria-iva-total]').invoke('text').should('match', /7[.,]30/)
          cy.get('[data-cy=gestoria-methods]').should('contain', 'Card')
          cy.get('[data-cy=gestoria-download]').should('not.be.disabled')

          const q = Math.floor(new Date().getMonth() / 3)
          const y = new Date().getFullYear()
          const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
          const to = new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10)
          cy.get('[data-cy=gestoria-pdfs-1]').should('contain', 'Download PDFs')
          cy.request({ method: 'POST', url: '/api/reports/gestoria-export', body: { from, to } }).then((res) => {
            expect(res.body.count).to.eq(2)
            cy.request({ url: res.body.url, encoding: 'binary' }).then((zip) => {
              const body = zip.body as string
              expect(body.slice(0, 2)).to.eq('PK')
              for (const name of ['libro-facturas-expedidas.csv', 'resumen-iva.csv', 'cobros.csv']) expect(body).to.contain(name)
            })
          })
          // The PDFs, as the first (and here only) part.
          cy.request({ method: 'POST', url: '/api/reports/gestoria-export', body: { from, to, pdfPart: 0 } }).then((res) => {
            cy.request({ url: res.body.url, encoding: 'binary' }).then((zip) => {
              expect((zip.body.match(/facturas\/F-\d{4}-\d{4}\.pdf/g) ?? []).length).to.be.at.least(2)
              expect(zip.body).not.to.contain('libro-facturas-expedidas.csv')
            })
          })
        })
      })
    })
  })

  it('is refused to a role without reports access (Front Desk)', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `gestoria-${Date.now()}@example.test`
      const password = 'valencia2026'
      cy.task('db:createTeamMemberWithRole', { accountId: account.accountId, clinicId: account.clinicId, roleName: 'Front Desk', email, password, fullName: 'Recepción' })
      cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
        cy.request({ method: 'POST', url: '/api/reports/gestoria-export', headers: { Authorization: `Bearer ${token}` }, body: { from: '2026-01-01', to: '2026-03-31', preview: true }, failOnStatusCode: false }).its('status').should('eq', 403)
      })
    })
  })
})
