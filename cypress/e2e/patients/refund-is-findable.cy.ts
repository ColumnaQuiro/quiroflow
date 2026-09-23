// Where the refund is, rather than what it does.
//
// Refunding worked, and could not be found. The action existed only inside a
// ledger row's expanded detail panel, so a collapsed ledger showed no sign of
// it, and /billing/<id> -- the page "Open receipt" takes you to, and the
// obvious place to act on one receipt -- offered nothing at all. Worse, on a
// paid receipt that page DISABLES "Void receipt" with a tooltip telling staff
// to "refund the payments first", then gave them no refund and no way to
// reach one. It named an action it did not provide.
//
// The refund still happens in exactly one place: the modal writes a REF-
// invoice, a matching negative payment and a VeriFactu rectificativa, and a
// second implementation of that drifting from the first is a fiscal problem.
// So the receipt page navigates to the ledger with the receipt selected, and
// these assert the route rather than a second refund path.
describe('Finding the refund', () => {
  const seedPaidReceipt = () =>
    cy.seedStaffAccount().then((account) =>
      cy
        .task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fina', lastName: 'Findable' })
        .then((patient: any) =>
          cy
            .task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'paid' })
            .then((invoice: any) =>
              cy
                .task('db:createPayment', { accountId: account.accountId, patientId: patient.id, invoiceId: invoice.id, amountCents: 5000, method: 'card' })
                .then(() => ({ account, patient, invoice })),
            ),
        ),
    )

  it('offers Refund on the ledger row without expanding it', () => {
    cy.viewport(1440, 900)
    seedPaidReceipt().then(({ account, patient }) => {
      cy.login(account.email, account.password)
      cy.visit(`/patients/${patient.id}?tab=money`)

      // Collapsed. Nothing has been clicked open, which is the whole point --
      // this used to require knowing the detail panel was there.
      //
      // Scrolled to first: the ledger sits below the bonos and memberships
      // now, so the row starts off-screen at 900px. Only the VERTICAL
      // position changes -- the two horizontal measurements below are
      // viewport-relative and still mean exactly what they meant.
      cy.contains('tr', 'Receipt').scrollIntoView().should('be.visible').find('button').contains('Refund…').should('be.visible')

      // Visible in the sense that matters: the action column is the eighth in
      // a table that was already using the full width, so "renders" is not the
      // same as "can be seen". be.visible would not catch it being pushed off
      // the side, and the whole change is worthless if it is.
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth, 'the ledger did not widen the page').to.be.at.most(doc.documentElement.clientWidth + 1)
      })
      cy.contains('button', 'Refund…').then(($b) => {
        const box = $b[0].getBoundingClientRect()
        expect(box.width, 'the button has been laid out').to.be.greaterThan(0)
        expect(box.right, 'and sits inside the viewport').to.be.at.most(Cypress.config('viewportWidth'))
      })
    })
  })

  it('gets from the receipt page to the refund, which the void tooltip promises', () => {
    seedPaidReceipt().then(({ account, patient, invoice }) => {
      cy.login(account.email, account.password)
      cy.visit(`/billing/${invoice.id}`)

      // The dead end: Void is refused and points at refunding instead, so a
      // refund has to be reachable from here.
      cy.contains('button', 'Void receipt').should('be.disabled')
      cy.contains('button', 'Refund…').click()

      cy.location('pathname').should('eq', `/patients/${patient.id}`)
      cy.location('search').should('contain', `refund=${invoice.id}`)

      // Landed with the modal already open and the full amount pre-filled --
      // arriving on the Money tab and having to find the row again would not
      // have fixed anything.
      cy.contains('Reason (optional)').should('be.visible')
      cy.contains('label', 'Amount').parent().find('input').should('have.value', '50.00')
    })
  })

  it('does not offer a refund on a receipt with no money on it', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Unpaid' }).then((patient: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 5000, status: 'unpaid' }).then((invoice: any) => {
          cy.login(account.email, account.password)

          // Nothing was collected, so there is nothing to give back -- the
          // open amount is a write-off's job, not a refund's.
          cy.visit(`/billing/${invoice.id}`)
          cy.contains('button', 'Refund…').should('not.exist')
          cy.contains('button', 'Void receipt').should('not.be.disabled')

          cy.visit(`/patients/${patient.id}?tab=money`)
          cy.contains('tr', 'Receipt').scrollIntoView().should('be.visible')
          cy.contains('button', 'Refund…').should('not.exist')
        })
      })
    })
  })
})
