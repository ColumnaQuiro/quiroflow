// One taxpayer per account: every factura carries the oldest clinic's legal
// name and NIF (fill_factura_issuer, record_factura_alta). Until 30 Sep 2026
// the other clinics asked for a NIF they never used, and the oldest one could
// be deleted -- changing the obligado midway through a VeriFactu chain. And
// IVA on facturas was an account setting nobody could reach from Settings.

function factura(account: { accountId: string; clinicId: string }, opts: { number: string; amountCents: number; taxFromAccount?: boolean }) {
  return cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana' }).then((p) =>
    cy.task<{ id: string }>('db:createPayment', { accountId: account.accountId, patientId: p.id, amountCents: opts.amountCents, method: 'cash' }).then((pay) =>
      cy
        .task<{ id: string }>('db:createFactura', {
          accountId: account.accountId,
          patientId: p.id,
          paymentId: pay.id,
          number: opts.number,
          description: 'Sesión',
          amountCents: opts.amountCents,
          taxFromAccount: opts.taxFromAccount,
        })
        .then(() => cy.task<any[]>('db:facturasFor', { patientId: p.id }).its(0)),
    ),
  )
}

describe('The clinic facturas are issued under, and IVA', () => {
  it('keeps the fiscal clinic once facturas exist, and tells the other locations whose NIF they use', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createClinic', { accountId: account.accountId, name: 'Sede Centro' }).then((centro) => {
        factura(account, { number: 'F-2026-0001', amountCents: 4500 })
        cy.login(account.email, account.password)

        cy.visit('/settings/clinics')
        cy.get(`[data-clinic-id="${account.clinicId}"] [data-cy="clinic-card-fiscal"]`).should('exist')
        cy.get(`[data-clinic-id="${centro.id}"] [data-cy="clinic-card-fiscal"]`).should('not.exist')
        cy.get(`[data-clinic-id="${centro.id}"] [data-cy="clinic-card-missing-nif"]`).should('not.exist')

        cy.visit(`/settings/clinics/${centro.id}`)
        cy.get('[data-cy="clinic-fiscal-elsewhere"]').scrollIntoView().should('be.visible')
        cy.get('[data-cy="clinic-tax-id"]').should('not.exist')

        cy.visit(`/settings/clinics/${account.clinicId}`)
        cy.get('[data-cy="clinic-tax-id"]').should('exist')
        cy.get('[data-cy="clinic-delete-unavailable"]').scrollIntoView().should('contain', 'facturas are issued under')
        cy.get('[data-cy="clinic-delete"]').should('be.disabled')

        // And the database, whatever the page shows.
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email: account.email,
          password: account.password,
          table: 'clinics',
          op: 'delete',
          match: { id: account.clinicId },
        }).its('error').should('match', /legal name and NIF/)
      })
    })
  })

  it('issues facturas with IVA once it is switched on, and exempt again once it is off', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="factura-tax"]').scrollIntoView()
      cy.get('[data-cy="tax-exempt"]').should('be.checked')
      cy.get('[data-cy="tax-exemption-code"]').should('have.value', 'E1')

      cy.get('[data-cy="tax-taxed"]').check()
      cy.get('[data-cy="tax-rate"]').clear().type('21')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.get('[data-cy="invoice-settings-save"]').should('contain', 'Save changes')

      // What the patient paid is split, so the total still matches the payment.
      factura(account, { number: 'F-2026-0002', amountCents: 12100, taxFromAccount: true }).then((row: any) => {
        expect(row.tax_rate_bp).to.eq(2100)
        expect(row.tax_base_cents).to.eq(10000)
        expect(row.tax_amount_cents).to.eq(2100)
        expect(row.tax_exemption_code).to.eq(null)
      })

      cy.reload()
      cy.get('[data-cy="tax-taxed"]').should('be.checked')
      cy.get('[data-cy="tax-rate"]').should('have.value', '21')
      cy.get('[data-cy="tax-exempt"]').check()
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.get('[data-cy="invoice-settings-save"]').should('contain', 'Save changes')
      factura(account, { number: 'F-2026-0003', amountCents: 4500, taxFromAccount: true }).then((row: any) => {
        expect(row.tax_rate_bp).to.eq(0)
        expect(row.tax_exemption_code).to.eq('E1')
      })
    })
  })

  it('refuses a rate that is not a percentage', () => {
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="tax-taxed"]').scrollIntoView().check()
      cy.get('[data-cy="tax-rate"]').clear().type('veintiuno')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.contains('between 0 and 30').should('be.visible')
      cy.get('@saveAccount.all').should('have.length', 0)
    })
  })
})
