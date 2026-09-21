// Scoping the receipt list to one patient, so the patient record can link out
// to "every receipt for this person" without the ledger having to leave the
// record to make that reachable.
//
// The status counts and the header's outstanding total are asserted alongside
// the rows on purpose. A chip reading "Unpaid · 12" above a list showing one
// patient's single unpaid receipt is the same class of lie as the 1000-row
// cap those counts were rewritten to fix -- it just fails quietly instead of
// loudly.
describe('Receipts filtered to one patient', () => {
  it('scopes the rows, the status counts and the outstanding total', () => {
    cy.seedStaffAccount().then((account) => {
      const base = { accountId: account.accountId, clinicId: account.clinicId }

      cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Alba', lastName: 'Esteve' }).then((mine) => {
        cy.task<{ id: string }>('db:createPatient', { ...base, firstName: 'Nuria', lastName: 'Bellver' }).then((other) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: mine.id, totalCents: 4500, status: 'unpaid' })
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: mine.id, totalCents: 6500, status: 'paid' })
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: other.id, totalCents: 9900, status: 'unpaid' })

          cy.login(account.email, account.password)

          // Unfiltered: every receipt the clinic has issued.
          cy.visit('/billing')
          cy.contains('button', /^All/).click()
          cy.contains('Alba').should('exist')
          cy.contains('Nuria').should('exist')

          // Filtered: one patient, named, with a way back to their record.
          cy.visit(`/billing?patient=${mine.id}`)
          cy.contains('Alba Esteve').should('be.visible')
          cy.contains('a', 'Open patient record').should('have.attr', 'href', `/patients/${mine.id}`)

          cy.contains('button', /^All/).click()
          cy.contains('Nuria').should('not.exist')
          cy.contains('Alba').should('exist')

          // The chips count this patient, not the clinic.
          cy.contains('button', /^All\s*·\s*2$/).should('exist')
          cy.contains('button', /^Unpaid\s*·\s*1$/).should('exist')
          cy.contains('button', /^Paid\s*·\s*1$/).should('exist')

          // And so does the header's outstanding figure: 45, not 144.
          cy.contains('€45 outstanding across 1 receipt').should('be.visible')

          // Clearing it gives the clinic back.
          cy.get('button[aria-label="Show every patient"]').click()
          cy.contains('button', /^All/).click()
          cy.contains('Nuria').should('exist')
        })
      })
    })
  })

  it('says which filter emptied the list', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Rosa',
        lastName: 'Quintana',
      }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/billing?patient=${patient.id}`)
        // Not the generic "No receipts yet." -- the clinic may have plenty.
        cy.contains('No receipts for this patient.').should('be.visible')
      })
    })
  })
})
