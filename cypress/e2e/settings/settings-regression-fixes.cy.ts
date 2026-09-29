// Found in the review round after the settings redesign (#495, #497, #498).
// Each of these passed every existing spec, because none of them exercised
// the input or the figure involved.

describe('Settings review fixes', () => {
  it('saves a typed receipt number without breaking the page', () => {
    // A number input's v-model hands back a Number; the page called .trim()
    // on it, so typing a digit broke Invoicing and Save stuck on "Saving…".
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')

      cy.get('[data-cy="receipt-next"]').type('1208')
      cy.contains('Keeps counting on its own').should('not.exist')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.wait('@saveAccount').its('request.body.next_invoice_number').should('eq', 1208)
      cy.get('[data-cy="invoice-settings-save"]').should('contain', 'Save changes')
    })
  })

  it('refuses a bono or a plan with no price, rather than saving it at 0 €', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)

      cy.visit('/settings/packages')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.get('[data-cy="package-add"]').click()
      cy.get('[data-cy="package-name-input"]').type('Bono sin precio')
      cy.get('[data-cy="package-save"]').click()
      cy.get('[data-cy="package-form"]').should('contain', 'a price')
      cy.contains('[data-cy="package-card"]', 'Bono sin precio').should('not.exist')

      cy.visit('/settings/memberships')
      cy.get('[data-cy="settings-list"][data-ready="true"]')
      cy.get('[data-cy="membership-add"]').click()
      cy.get('[data-cy="membership-name-input"]').type('Plan sin precio')
      cy.get('[data-cy="membership-save"]').click()
      cy.get('[data-cy="membership-form"]').should('contain', 'a price')
      cy.contains('[data-cy="membership-row"]', 'Plan sin precio').should('not.exist')
    })
  })

  it('keeps a charged service, whoever asks to delete it', () => {
    // The page counts only receipts its user can open; the database sees them
    // all and refuses.
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createServiceProduct', { accountId: account.accountId, name: 'Radiografía', priceCents: 4500 }).then((service) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rosa' }).then((patient: any) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4500, status: 'unpaid' }).then((inv: any) => {
            cy.task('db:chargeService', { accountId: account.accountId, invoiceId: inv.id, serviceId: service.id, priceCents: 4500 })
            cy.task('db:deleteServiceProduct', { serviceId: service.id }).its('code').should('eq', '23503')
          })
        })
      })
    })
  })

  it('prints the account balance the patient list shows', () => {
    // It used to take the statement's running sum, which counts a payment
    // made from credit, and the credit it came from, twice.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Berta', lastName: 'Balance' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 11500, method: 'cash' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4000, status: 'unpaid' }).then((inv: any) => {
          cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
          cy.login(account.email, account.password)
          cy.visit('/settings/invoicing')
          cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
          cy.get('[data-cy="receipt-show-account"]').should('have.attr', 'aria-checked', 'false').click()
          cy.get('[data-cy="invoice-settings-save"]').click()
          cy.wait('@saveAccount')

          cy.task<number>('db:liveBalance', { patientId: patient.id }).then((cents) => {
            // The extractor turns the € into an invisible character, as on
            // every amount in this PDF, so the sign is matched loosely.
            const amount = (Math.abs(cents) / 100).toFixed(2).replace('.', '\\.')
            const expected = new RegExp(`Account balance: \\D{0,2}${amount} ${cents < 0 ? 'due' : 'credit'}`)
            cy.request({ url: `/api/invoices/${inv.id}/pdf`, encoding: 'binary' })
              .then((res) => cy.task('pdf:text', { binary: res.body }))
              .then((texts) => expect((texts as string[]).join('\n')).to.match(expected))
          })
        })
      })
    })
  })
})
