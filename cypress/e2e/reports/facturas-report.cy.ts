import { computePresetRange } from '../../../composables/useDateRangePresets'

// Reports › Facturas emitidas (pages/reports/facturas.vue): every factura
// issued in the period, with the totals and the IVA above, filters by type
// and search, and the libro registro as a CSV (utils/gestoriaExport.ts).
describe('Issued facturas report', () => {
  it('lists the period’s facturas with their totals, filters them and exports the CSV', () => {
    cy.seedStaffAccount().then((account) => {
      const factura = (first: string, number: string, cents: number, kind = 'simplified') =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Factura' }).then((patient) =>
          cy.task<{ id: string }>('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: cents, method: 'card' }).then((payment) =>
            cy.task('db:createFactura', { accountId: account.accountId, patientId: patient.id, paymentId: payment.id, number, kind, description: 'Consulta', amountCents: cents }),
          ),
        )
      factura('Ana', 'FT-2026-0001', 4400)
      factura('Bruno', 'FT-2026-0002', 6000)
      factura('Carla', 'FC-2026-0001', 3000, 'full')

      cy.login(account.email, account.password)
      cy.visit('/reports/facturas')
      cy.get('[data-cy=facturas-report][data-ready=true]', { timeout: 20000 })
      cy.get('[data-cy=facturas-count]').should('have.text', '3')
      cy.get('[data-cy=facturas-total]').should('contain', '134,00')
      cy.get('[data-cy=facturas-row]').should('have.length', 3).first().should('contain', 'Carla Factura')

      cy.get('[data-cy=facturas-kind-full]').click()
      cy.get('[data-cy=facturas-row]').should('have.length', 1).and('contain', 'FC-2026-0001')
      cy.get('[data-cy=facturas-count]').should('have.text', '1')

      cy.contains('button', /^All/).click()
      cy.get('[data-cy=facturas-search]').type('bruno')
      cy.get('[data-cy=facturas-row]').should('have.length', 1).and('contain', 'FT-2026-0002')
      cy.get('[data-cy=facturas-total]').should('contain', '60,00')

      cy.get('[data-cy=facturas-search]').clear()
      cy.get('[data-cy=facturas-csv]').click()
      const range = computePresetRange({ months: 1 })
      cy.readFile(`cypress/downloads/facturas-emitidas-${range.from}-${range.to}.csv`, { timeout: 15000 }).should((csv: string) => {
        expect(csv).to.contain('Número;')
        expect(csv).to.contain('FT-2026-0001').and.contain('FT-2026-0002').and.contain('FC-2026-0001')
        expect(csv).to.contain('44,00')
      })
    })
  })
})
