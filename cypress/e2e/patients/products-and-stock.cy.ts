// Products and stock: an owner sets a product up, receives a delivery and
// adjusts the count (Settings > Products & stock); the desk sells from the
// patient's Money tab, which takes the stock, records the payment and issues
// a factura per IVA rate at the PRODUCT's rate -- not the clinic's exemption.
describe('Products and stock', () => {
  it('sets a product up, receives a delivery, adjusts it, and shows the margin', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/products')
      cy.get('[data-cy=products-settings][data-ready=true]', { timeout: 20000 })
      cy.clickUntil('[data-cy=product-new]', '[data-cy=product-form]')
      cy.get('[data-cy=product-name]').type('Almohada cervical')
      cy.get('[data-cy=product-price]').type('36,30')
      cy.get('[data-cy=product-tax]').select('21 %')
      cy.get('[data-cy=product-min]').type('5')
      cy.get('[data-cy=product-save]').click()
      cy.get('[data-cy=product-row][data-name="Almohada cervical"]').find('[data-cy=product-stock]').should('contain', '0')

      cy.get('[data-cy=receive-product]').select('Almohada cervical')
      cy.get('[data-cy=receive-units]').type('10')
      cy.get('[data-cy=receive-cost]').type('18,00')
      cy.get('[data-cy=receive-supplier]').type('Ortopedia Demo')
      cy.get('[data-cy=receive-save]').click()
      cy.get('[data-cy=product-row][data-name="Almohada cervical"]').find('[data-cy=product-stock]').should('contain', '10')
      // 36,30 with 21 % IVA is 30,00 before tax; at 18,00 a unit, 40 %.
      cy.get('[data-cy=product-row][data-name="Almohada cervical"]').find('[data-cy=product-margin]').should('contain', '40 %')

      cy.get('[data-cy=product-row][data-name="Almohada cervical"]').find('[data-cy=product-adjust]').click()
      cy.get('[data-cy=adjust-delta]').type('-1')
      cy.get('[data-cy=adjust-reason]').type('Llegó rota')
      cy.get('[data-cy=adjust-save]').click()
      cy.get('[data-cy=product-row][data-name="Almohada cervical"]').find('[data-cy=product-stock]').should('contain', '9')
      cy.get('[data-cy=movement-row][data-kind=adjust]').should('contain', 'Llegó rota')
      cy.get('[data-cy=movement-row][data-kind=receive]').should('contain', 'Ortopedia Demo')

      // Units only move with a movement: not by writing the number.
      cy.task<{ kind: string; delta: number }[]>('db:selectRows', { table: 'product_stock_movements', columns: 'kind, delta', match: { account_id: account.accountId } }).then((rows) => {
        expect(rows.map((r) => [r.kind, r.delta]).sort()).to.deep.eq([['adjust', -1], ['receive', 10]])
      })
    })
  })

  it('sells from the Money tab: stock down, paid, one factura per IVA rate', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', {
        table: 'services_products',
        rows: [
          { account_id: account.accountId, kind: 'product', name: 'Almohada cervical', price_cents: 3630, tax_rate: 21, stock_units: 10, min_stock: 5 },
          { account_id: account.accountId, kind: 'product', name: 'Magnesio', price_cents: 1100, tax_rate: 10, stock_units: 7, min_stock: 6 },
          { account_id: account.accountId, kind: 'product', name: 'Banda elástica', price_cents: 900, tax_rate: 21, stock_units: 0, min_stock: 4 },
        ],
      })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Compra' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=money`)
        cy.get('[data-cy=sell-product-open]', { timeout: 20000 })
        cy.clickUntil('[data-cy=sell-product-open]', '[data-cy=sell-product]')
        cy.get('[data-cy=sell-product-row][data-name="Banda elástica"]').find('[data-cy=sell-product-add]').should('be.disabled')
        cy.get('[data-cy=sell-product-row][data-name="Almohada cervical"]').find('[data-cy=sell-product-add]').click()
        cy.get('[data-cy=sell-product-row][data-name="Almohada cervical"]').find('[data-cy=sell-product-more]').click()
        cy.get('[data-cy=sell-product-row][data-name="Magnesio"]').find('[data-cy=sell-product-add]').click()
        cy.get('[data-cy=sell-product-total]').invoke('text').should('match', /83[.,]60/)
        cy.get('[data-cy=sell-product-method]').select('card')
        cy.get('[data-cy=sell-product-submit]').click()
        cy.get('[data-cy=sell-product-done]').should('contain', 'Factura')

        cy.task<{ name: string; stock_units: number }[]>('db:selectRows', { table: 'services_products', columns: 'name, stock_units', match: { account_id: account.accountId } }).then((rows) => {
          const stock = Object.fromEntries(rows.map((r) => [r.name, r.stock_units]))
          expect(stock).to.deep.eq({ 'Almohada cervical': 8, Magnesio: 6, 'Banda elástica': 0 })
        })
        cy.task<{ status: string; total_cents: number }[]>('db:selectRows', { table: 'invoices', columns: 'status, total_cents', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows.map((r) => [r.status, r.total_cents]).sort()).to.deep.eq([['paid', 1100], ['paid', 7260]])
        })
        cy.task<{ amount_cents: number; method: string }[]>('db:selectRows', { table: 'payments', columns: 'amount_cents, method', match: { patient_id: patient.id } }).then((rows) => {
          expect(rows.map((r) => [r.amount_cents, r.method]).sort()).to.deep.eq([[1100, 'card'], [7260, 'card']])
        })
        // At the product's IVA, with the cuota worked back from the price paid.
        cy.task<{ amount_cents: number; tax_rate_bp: number; tax_base_cents: number; tax_amount_cents: number }[]>('db:selectRows', { table: 'facturas', columns: 'amount_cents, tax_rate_bp, tax_base_cents, tax_amount_cents', match: { patient_id: patient.id } }).then((rows) => {
          const byRate = Object.fromEntries(rows.map((r) => [r.tax_rate_bp, r]))
          expect(Object.keys(byRate).sort()).to.deep.eq(['1000', '2100'])
          expect(byRate[2100]).to.include({ amount_cents: 7260, tax_base_cents: 6000, tax_amount_cents: 1260 })
          expect(byRate[1000]).to.include({ amount_cents: 1100, tax_base_cents: 1000, tax_amount_cents: 100 })
        })

        // Magnesio is now at its minimum: the owner's My Day says so.
        cy.visit('/practitioner')
        cy.get('[data-cy=low-stock]', { timeout: 20000 }).should('contain', 'Magnesio').and('contain', 'Banda elástica')
      })
    })
  })

  it('refuses to sell more than is on the shelf, and takes nothing', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:insertRows', { table: 'services_products', rows: [{ account_id: account.accountId, kind: 'product', name: 'Magnesio', price_cents: 1100, tax_rate: 10, stock_units: 2 }] })
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Compra' }).then((patient) => {
          cy.task<{ id: string }[]>('db:selectRows', { table: 'services_products', columns: 'id', match: { account_id: account.accountId } }).then((products) => {
            cy.login(account.email, account.password)
            cy.visit('/settings/products')
            cy.get('[data-cy=products-settings][data-ready=true]', { timeout: 20000 })
            cy.request({ method: 'POST', url: '/api/products/sell', body: { patientId: patient.id, method: 'cash', items: [{ productId: products[0]!.id, quantity: 3 }] }, failOnStatusCode: false }).then((res) => {
              expect(res.status).to.eq(400)
              expect(res.body.statusMessage ?? res.body.message).to.contain('Only 2')
            })
            cy.task('db:selectRows', { table: 'invoices', columns: 'id', match: { patient_id: patient.id } }).should('have.length', 0)
            cy.task('db:selectRows', { table: 'services_products', columns: 'stock_units', match: { account_id: account.accountId } }).its('0.stock_units').should('eq', 2)
          })
      })
    })
  })

  it('refunds a product at its own IVA, not the clinic exemption', () => {
    cy.seedStaffAccount().then((account) => {
      // Exempt for its services, as a physiotherapy clinic is.
      cy.task('db:updateRows', { table: 'accounts', values: { factura_tax_exemption_code: 'E1', factura_tax_rate_bp: 0 }, match: { id: account.accountId } })
      cy.task<{ id: string }[]>('db:insertRows', { table: 'services_products', rows: [{ account_id: account.accountId, kind: 'product', name: 'Almohada cervical', price_cents: 3630, tax_rate: 21, stock_units: 5 }] }).then(([product]) => {
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Devuelve' }).then((patient) => {
          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=money`)
          cy.get('[data-cy=sell-product-open]', { timeout: 20000 })
          cy.request({ method: 'POST', url: '/api/products/sell', body: { patientId: patient.id, method: 'card', items: [{ productId: product!.id, quantity: 1 }] } }).its('body.sales.0.factura').should('match', /^F-/)
          cy.reload()
          cy.contains('tr', 'Receipt', { timeout: 20000 }).click()
          cy.contains('button', 'Refund…').click()
          cy.contains('Reason (optional)').parent().find('input').type('devolución')
          cy.get('.fixed').contains('button', 'Refund').click()
          cy.contains('Reason (optional)').should('not.exist')
          cy.contains('button', 'Facturas & receipts').click()
          cy.contains('li', 'R-').should('be.visible')
          cy.task<{ kind: string; amount_cents: number; tax_rate_bp: number; tax_base_cents: number; tax_amount_cents: number; tax_exemption_code: string | null }[]>('db:selectRows', {
            table: 'facturas',
            columns: 'kind, amount_cents, tax_rate_bp, tax_base_cents, tax_amount_cents, tax_exemption_code',
            match: { patient_id: patient.id },
          }).then((rows) => {
            const rectifying = rows.find((r) => r.kind === 'rectificativa')!
            expect(rectifying).to.include({ amount_cents: -3630, tax_rate_bp: 2100, tax_base_cents: -3000, tax_amount_cents: -630, tax_exemption_code: null })
          })
        })
      })
    })
  })
})
