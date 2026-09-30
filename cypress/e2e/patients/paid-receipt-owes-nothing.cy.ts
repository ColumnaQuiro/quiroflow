// A receipt marked paid owes nothing, whether or not payment rows sit under
// it. A visit drawn from a prepaid bono is exactly that shape -- raised paid,
// no payment, because the money came in when the bono was bought -- and so is
// the whole migrated PracticeHub history (settle_imported_invoices).
//
// The appointment dialog already knew (prepaid-bono-visit-asks-for-nothing).
// The receipt page and its PDF did not: both read "due" as total minus
// payments, so the page showed the full session price as Total due with a
// form to record a payment for it -- the path that charged five patients
// twice on 15 Sep -- and the emailed PDF told the patient they owed it.
// A void receipt owes nothing either.
describe('A receipt already paid', () => {
  function receiptText(invoiceId: string) {
    return cy
      .request({ url: `/api/invoices/${invoiceId}/pdf`, encoding: 'binary' })
      .then((res) => {
        expect(res.status).to.eq(200)
        return cy.task('pdf:text', { binary: res.body })
      })
      .then((texts) => (texts as string[]).join('\n'))
  }

  it('shows nothing due and offers no payment when it has no payment rows', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Bono' }).then((patient) => {
        cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'paid' }).then((inv) => {
          cy.login(account.email, account.password)
          cy.visit(`/billing/${inv.id}`)

          cy.contains('span', 'Total due').parent().should('contain.text', '0,00')
          cy.contains('No payments recorded.').should('be.visible')
          cy.contains('label', 'Amount (€)').should('not.exist')

          // The extractor turns the € into an invisible character.
          receiptText(inv.id).should('match', /Balance due: \D{0,2}0\.00/)
        })
      })
    })
  })

  it('prints nothing due on a void receipt', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Vic', lastName: 'Void' }).then((patient) => {
        cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'void' }).then((inv) => {
          cy.login(account.email, account.password)
          receiptText(inv.id).should('match', /Balance due: \D{0,2}0\.00/)
        })
      })
    })
  })

  it('still shows what is due on an unpaid receipt', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Uxue', lastName: 'Unpaid' }).then((patient) => {
        cy.task<any>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' }).then((inv) => {
          cy.login(account.email, account.password)
          cy.visit(`/billing/${inv.id}`)
          cy.contains('span', 'Total due').parent().should('contain.text', '44,00')
          cy.contains('label', 'Amount (€)').should('be.visible')
          receiptText(inv.id).should('match', /Balance due: \D{0,2}44\.00/)
        })
      })
    })
  })
})
