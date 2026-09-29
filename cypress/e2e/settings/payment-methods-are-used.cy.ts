// Settings -> Payments (formerly Payment Methods) has existed since 0100 and has never been wired
// to anything. Staff could add a method, its own help text suggested "Bank
// Transfer", and the method then appeared in no payment form: every dropdown
// hardcoded its own <option> list and payments.method was a check constraint
// naming five fixed strings.
//
// The test that earns its place is the whole round trip -- add one in
// Settings, then take a payment with it -- because each half passed on its
// own the entire time.
describe('Payment methods', () => {
  it('offers a method added in Settings when taking a payment', () => {
    cy.seedStaffAccount().then((account) => {
      cy.login(account.email, account.password)
      cy.visit('/settings/payments')
      cy.get('[data-cy="payments-settings"][data-ready="true"]')

      // Seeded by the migration, so a clinic has something on day one rather
      // than an empty screen -- which is what every account created after
      // 0100 actually had, since nothing seeded them.
      // exist rather than be.visible: the table scrolls inside an
      // overflow-hidden container, so a row below the fold reads as hidden
      // even when it is rendered.
      cy.contains('Bank transfer').should('exist')
      cy.contains('Bizum').should('exist')

      cy.get('[data-cy="method-new-name"]').type('Cheque regalo')
      cy.get('[data-cy="method-add"]').click()
      cy.contains('[data-cy="method-name"]', 'Cheque regalo').should('exist')

      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Paga', lastName: 'Transferencia' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })
        cy.visit(`/patients/${patient.id}?tab=billing`)

        cy.contains('INV-').should('exist')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').as('form')

        // By its label, not by index: the first select in this form is the
        // invoice picker, which is what made the first version of this test
        // look like the dropdown was empty.
        cy.get('@form').contains('label', 'Method').parent().find('select').as('method')
        // Both the seeded method and the one just added are selectable.
        cy.get('@method').select('Cheque regalo')
        cy.get('@method').select('Bank transfer')
        cy.get('@form').contains('button', 'Record payment').click()
        cy.contains('button', 'Recording…').should('not.exist')

        // And it is what got stored -- the key, not the label, so renaming the
        // method later does not orphan the payment.
        cy.task('db:paymentsFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows, 'one payment').to.have.length(1)
          expect(rows[0].method, 'stored as the stable key').to.eq('transfer')
        })
      })
    })
  })

  it('offers Delete only on a method nothing has been paid with', () => {
    // Deleting one used to be allowed, which would leave those payments naming
    // a method the account no longer has and the by-method report grouping on
    // a key with nothing behind it. Turning it off is the answer, and the
    // foreign key is what makes the difference enforceable rather than advice;
    // the page now only offers Delete where the key would let it through.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ya', lastName: 'Pagado' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4400, method: 'transfer' })

        cy.login(account.email, account.password)
        cy.visit('/settings/payments')
        cy.get('[data-cy="payments-settings"][data-ready="true"]')

        cy.contains('[data-cy="method-row"]', 'Bank transfer').as('used')
        cy.get('@used').find('[data-cy="method-uses"]').should('have.text', '1 payment')
        cy.get('@used').find('[data-cy="method-delete"]').should('not.exist')

        // Turning it off keeps it, and its history.
        cy.get('@used').find('[data-cy="method-active"]').should('have.attr', 'aria-checked', 'true').click()
        cy.contains('[data-cy="method-row"]', 'Bank transfer').find('[data-cy="method-active"]').should('have.attr', 'aria-checked', 'false')

        // One nothing has used can go.
        cy.get('[data-cy="method-new-name"]').type('Vale')
        cy.get('[data-cy="method-add"]').click()
        cy.contains('[data-cy="method-row"]', 'Vale').find('[data-cy="method-delete"]').click()
        cy.contains('[data-cy="method-name"]', 'Vale').should('not.exist')
      })
    })
  })
})
