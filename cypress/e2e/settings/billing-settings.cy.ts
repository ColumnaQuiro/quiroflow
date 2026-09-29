// Settings > Payments and Settings > Invoicing: five billing pages became
// three (VeriFactu is the third, and has its own specs).

describe('Billing settings', () => {
  it('sends the old addresses to the pages that took them over', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      // In bookmarks, in older help messages, and in the settings index people
      // scrolled past for months.
      cy.visit('/settings/payment-methods')
      cy.location('pathname').should('eq', '/settings/payments')
      cy.visit('/settings/invoice-settings')
      cy.location('pathname').should('eq', '/settings/invoicing')
      cy.visit('/settings/fiscal-data')
      cy.location('pathname').should('eq', '/settings/invoicing')
      cy.get('[data-cy="fiscal-clinic"]').should('have.length.at.least', 1)
    })
  })

  it('says whether each clinic can issue a valid factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
      cy.get('[data-cy="ready-fiscal"]').should('contain', 'clinics complete')
      cy.get('[data-cy="fiscal-clinic"]').first().should('have.attr', 'href').and('match', /\/settings\/clinics\/.+#fiscal$/)
    })
  })

  it('saves a receipt switch the right way round', () => {
    // On screen every option is "show"; the columns are a mix of show_* and
    // hide_*, and the hide_* ones are flipped on the page. Turning "Your next
    // visit" off must store hide_next_visit_on_invoices = true, which is what
    // the receipt reads.
    cy.seedStaffAccount().then((account) => {
      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')

      cy.get('[data-cy="receipt-show-next"]').should('have.attr', 'aria-checked', 'true').click()
      cy.get('[data-cy="receipt-show-next"]').should('have.attr', 'aria-checked', 'false')
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.wait('@saveAccount').its('request.body.hide_next_visit_on_invoices').should('eq', true)

      cy.reload()
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
      cy.get('[data-cy="receipt-show-next"]').should('have.attr', 'aria-checked', 'false')
    })
  })
})

// The receipt options did nothing for their first year: nine switches, an
// auto-email default and an email template were saved and never read. These
// read the PDF's own text, because the document is what the patient keeps.
describe('Receipt options', () => {
  function receiptText(invoiceId: string) {
    return cy
      .request({ url: `/api/invoices/${invoiceId}/pdf`, encoding: 'binary' })
      .then((res) => {
        expect(res.status).to.eq(200)
        return cy.task('pdf:text', { binary: res.body })
      })
      .then((texts) => (texts as string[]).join('\n'))
  }

  it('the receipt PDF follows the switches', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Olga', lastName: 'Opciones' }).then((patient: any) => {
        cy.task('db:setPatientNif', { patientId: patient.id, nationalId: '12345678Z' })
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((inv: any) => {
          cy.login(account.email, account.password)

          // As receipts have always printed: the ID, what was paid, no tax line.
          receiptText(inv.id).then((text) => {
            expect(text).to.contain('12345678Z')
            expect(text).to.contain('Paid:')
            expect(text).not.to.contain('IVA')
          })

          cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
          cy.visit('/settings/invoicing')
          cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
          cy.get('[data-cy="receipt-show-ssn"]').should('have.attr', 'aria-checked', 'true').click()
          cy.get('[data-cy="receipt-show-payments"]').click()
          cy.get('[data-cy="receipt-show-taxes"]').should('have.attr', 'aria-checked', 'false').click()
          cy.get('[data-cy="invoice-settings-save"]').click()
          cy.wait('@saveAccount')

          receiptText(inv.id).then((text) => {
            expect(text).not.to.contain('12345678Z')
            expect(text).not.to.contain('Paid:')
            expect(text).to.contain('IVA')
          })
        })
      })
    })
  })

  it('new patients start with the account’s auto-email choice', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Antes' }).then((before: any) => {
        cy.task('db:patientInvoiceEmail', { patientId: before.id }).should('eq', false)
      })

      cy.intercept('PATCH', '**/rest/v1/accounts*').as('saveAccount')
      cy.login(account.email, account.password)
      cy.visit('/settings/invoicing')
      cy.get('[data-cy="invoicing-settings"][data-ready="true"]')
      cy.get('[data-cy="receipt-send-automatically"]').click()
      cy.get('[data-cy="invoice-settings-save"]').click()
      cy.wait('@saveAccount').its('request.body.send_invoices_automatically_default').should('eq', true)

      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Despues' }).then((after: any) => {
        cy.task('db:patientInvoiceEmail', { patientId: after.id }).should('eq', true)
      })
    })
  })
})
