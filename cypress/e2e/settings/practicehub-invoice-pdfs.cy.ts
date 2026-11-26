// An invoice imported from PracticeHub arrives as its figures: QuiroFlow can
// print a receipt from them, but not the document the clinic issued, and a
// copy of that has to be kept after the clinic leaves PracticeHub. Its API has
// no PDF, so Settings > Import > Invoice originals signs in to the website
// and the server files each invoice's PDF with its patient -- but only when
// PracticeHub's invoice and the one here agree on number, day, amount and
// patient, because a PDF filed on the wrong patient hands their invoice to
// someone else.
//
// Run against a stub of that website: the sign-in, Finances > Invoices
// (newest first, as PracticeHub serves it) and the Print button's PDF.
describe('Bringing invoice originals from PracticeHub', () => {
  // Test values for the stub; nothing real signs in with them.
  const web = {
    email: 'recepcion@clinica-demo.test',
    password: 'stub-password-1',
    patients: [],
    invoices: [
      { number: 101, webId: 'AbCdEf12GhIj0101', date: '5th March, 2026', amount: '46.00', patient: 'Lucía Ferrer' },
      // Voided: PracticeHub prints no number, so there is nothing here to file it with.
      { number: null, webId: 'AbCdEf12GhIj0000', date: '5th March, 2026', amount: '46.00', patient: 'Lucía Ferrer' },
      // Imported here for a different amount: not the same invoice, never filed.
      { number: 102, webId: 'AbCdEf12GhIj0102', date: '5th March, 2026', amount: '46.00', patient: 'Tomás Vidal' },
      // Never imported here.
      { number: 103, webId: 'AbCdEf12GhIj0103', date: '6th March, 2026', amount: '40.00', patient: 'Irene Sala' },
    ],
  }

  afterEach(() => {
    cy.task('db:stopPracticeHubStub')
  })

  it('files each original with its patient, and leaves alone an invoice that does not match', () => {
    cy.seedStaffAccount().then((account) => {
      const patient = (firstName: string, lastName: string) => cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName, lastName })
      const invoice = (patientId: string, invoiceNumber: string, totalCents: number) =>
        cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId, invoiceNumber, totalCents, status: 'paid' }).then((inv) => {
          cy.task('db:updateRows', { table: 'invoices', values: { created_at: '2026-03-05T11:00:00Z' }, match: { id: inv.id } })
          return cy.wrap(inv)
        })

      patient('Lucía', 'Ferrer').then((lucia) => {
        patient('Tomás', 'Vidal').then((tomas) => {
          invoice(lucia.id, 'PHI-101', 4600).then((matching) => {
            invoice(tomas.id, 'PHI-102', 4300).then((differing) => {
              cy.task<{ baseUrl: string }>('db:startPracticeHubStub', { web }).then(({ baseUrl }) => {
                cy.task('db:setPracticeHubConnection', { accountId: account.accountId, baseUrl })
                cy.login(account.email, account.password)

                cy.visit('/settings/import?source=practicehub&step=invoice_pdfs&type=invoice_pdfs')
                cy.get('[data-cy=import-settings][data-ready=true]')
                cy.get('[data-cy=ph-invoice-pdfs]').within(() => {
                  cy.get('[data-cy=ph-web-email]').type(web.email)
                  cy.get('[data-cy=ph-web-password]').type(web.password)
                  cy.get('[data-cy=ph-web-connect-submit]').click()
                  cy.get('[data-cy=ph-web-connected]').should('contain', web.email)

                  cy.get('[data-cy=ph-invoices-total]').should('have.text', '2')
                  cy.get('[data-cy=ph-invoices-originals]').should('have.text', '0')
                  cy.get('[data-cy=ph-invoices-start]').click()
                  // The work happens on the server; the page only asks how far it got.
                  cy.get('[data-cy=ph-invoices-done]', { timeout: 60000 }).should('be.visible')
                  cy.get('[data-cy=ph-invoices-originals]').should('have.text', '1')
                  cy.get('[data-cy=ph-invoices-mismatched]').should('contain', 'PHI-102')
                  cy.get('[data-cy=ph-invoices-not-here]').should('contain', '1')
                })

                const filed = () =>
                  cy.task<{ external_reference: string; patient_id: string; file_name: string; file_type: string; storage_path: string | null }[]>('db:selectRows', {
                    table: 'patient_files',
                    columns: 'external_reference, patient_id, file_name, file_type, storage_path',
                    match: { account_id: account.accountId },
                  })
                filed().then((files) => {
                  expect(files).to.have.length(1)
                  expect(files[0].external_reference).to.eq('PH-invoice-pdf-101')
                  expect(files[0].patient_id).to.eq(lucia.id)
                  expect(files[0].file_type).to.eq('application/pdf')
                  expect(files[0].file_name).to.eq('Factura INV-101 2026-03-05 (original PracticeHub).pdf')
                  expect(files[0].storage_path).to.eq(`${account.accountId}/${lucia.id}/ph-invoice-101.pdf`)
                })

                // Again: what is already here is not filed twice.
                cy.get('[data-cy=ph-invoices-start]').click()
                cy.get('[data-cy=ph-invoices-done]', { timeout: 60000 }).should('contain', '0')
                filed().should('have.length', 1)

                // And from the invoice itself, the way to its original; not for the one that did not match.
                cy.visit(`/billing/${matching.id}`)
                cy.get('[data-cy=invoice-practicehub-original]').should('be.visible')
                cy.visit(`/billing/${differing.id}`)
                cy.contains('PHI-102')
                cy.get('[data-cy=invoice-practicehub-original]').should('not.exist')
              })
            })
          })
        })
      })
    })
  })
})
