// A patient list longer than a URL can name.
//
// Every filter PostgREST receives travels in the URL, and the API gateway
// refuses a request line past ~8 KB with 414 URI Too Long -- about 215 uuids
// in an `in.(...)`. A refused request reaches supabase-js as `data: null`,
// which every caller here read as "nothing": the export wrote 0.00 for
// anyone whose balance was in a refused chunk, and the balance filter and a
// phone search -- both built as id lists -- came back empty. The live account
// had 221 patients in credit when this was found, so "In credit" showed nobody.
describe('A patient list longer than one request can name', () => {
  function captureCsv() {
    cy.window().then((win) => {
      cy.stub(win.URL, 'createObjectURL').callsFake((blob: Blob) => {
        ;(win as any).__csv = blob
        return 'blob:captured'
      })
      cy.stub(win.URL, 'revokeObjectURL')
    })
  }

  function selectBalance(value: 'owing' | 'credit') {
    cy.get('select').then(($selects) => {
      const balance = [...$selects].find((s) => s.getAttribute('aria-label') === 'Balance')
      expect(balance, 'balance filter').to.exist
      cy.wrap(balance).select(value)
    })
  }

  it('exports the right balance for a debtor among 320 others', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 320 })
      // First by name, so first in the export -- inside the first chunk of
      // ids, which is the one a 300-id chunk lost whole.
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Aaron', lastName: 'Debe' }).then((p: any) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: p.id, totalCents: 4500, status: 'unpaid' })
      })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('321 patients', { timeout: 15000 }).should('be.visible')

      captureCsv()
      cy.contains('button', 'Export').click()
      cy.window()
        .its('__csv', { timeout: 20000 })
        .then((blob: Blob) => blob.text())
        .then((text: string) => {
          const lines = text.split('\n')
          expect(lines, 'header plus every patient').to.have.length(322)
          const debtor = lines.find((l) => l.startsWith('Aaron,Debe,'))
          expect(debtor, 'the debtor row').to.exist
          expect(debtor).to.contain(',-45.00,')
        })
    })
  })

  it('filters to 230 patients in credit', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 260, creditCount: 230 })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('260 patients', { timeout: 15000 }).should('be.visible')

      selectBalance('credit')
      cy.contains('230 patients').should('be.visible')
      cy.contains('tr', 'Crowd 000').should('contain.text', '10,00')

      // And the other way: nobody here owes, so Owing is empty -- a real
      // empty, from a request that succeeded.
      selectBalance('owing')
      // \b, because a plain '0 patients' is also a substring of '230 patients'.
      cy.contains(/\b0 patients/).should('be.visible')
    })
  })

  it('finds every patient whose phone matches, when that is hundreds', () => {
    cy.seedStaffAccount().then((account) => {
      // Numbers 600000000..600000249: "600" is in every one of them and in
      // none of the names, so each match below came through the phone.
      cy.task('db:seedManyPatients', { accountId: account.accountId, clinicId: account.clinicId, count: 250 })
      // One with no phone, so the search has to take the count somewhere.
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Crowd', lastName: 'Sinnumero' })

      cy.login(account.email, account.password)
      cy.visit('/patients')
      cy.contains('251 patients', { timeout: 15000 }).should('be.visible')

      cy.get('input[type="search"]').type('600')
      cy.contains('250 patients').should('be.visible')
      cy.contains('tr', 'Crowd 000').should('be.visible')
      cy.contains('Crowd Sinnumero').should('not.exist')

      // A number narrows to its one owner.
      cy.get('input[type="search"]').clear().type('600000249')
      cy.contains(/\b1 patients/).should('be.visible')
      cy.contains('tr', 'Crowd 249').should('be.visible')
    })
  })
})
