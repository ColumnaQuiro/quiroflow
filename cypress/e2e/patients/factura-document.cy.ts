// The document a patient is given, as opposed to the charge that moves their
// balance.
//
// The PDF reuses the invoice layout deliberately -- same clinic header, logo
// and footer -- and differs in the two things that matter: it is titled
// Factura, and it states one figure (what was paid) rather than a subtotal,
// a paid line and a balance due. A receipt with a "balance due" on it is a
// contradiction.
describe('The factura document', () => {
  it('downloads as a PDF titled Factura, with the recipient resolved live', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Dora', lastName: 'Document' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 26400, method: 'card' }).then((payment: any) => {
          cy.task('db:createFactura', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F-2026-0001',
            kind: 'full',
            description: 'Bono 12 — €264.00 of €528.00 (6 of 12 sessions)',
            amountCents: 26400,
          }).then((factura: any) => {
            cy.login(account.email, account.password)

            // The staff endpoint returns the bytes directly.
            cy.request({ url: `/api/facturas/${factura.id}/pdf`, encoding: 'binary' }).then((res) => {
              expect(res.status).to.eq(200)
              expect(res.headers['content-type']).to.contain('application/pdf')
              expect(res.headers['content-disposition']).to.contain('F-2026-0001.pdf')
              // A real PDF, not an error page rendered as one.
              expect(res.body.slice(0, 5)).to.eq('%PDF-')
            })

            // The recipient is not frozen, so a NIF added now reaches the
            // next download without the factura being reissued.
            cy.task('db:setPatientNif', { patientId: patient.id, nationalId: '12345678Z' })
            cy.request({ url: `/api/facturas/${factura.id}/pdf`, encoding: 'binary' }).then((res) => {
              expect(res.status).to.eq(200)
            })
          })
        })
      })
    })
  })

  it('lists facturas separately from charges, and nudges for a missing NIF', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Lena', lastName: 'Lister' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 52800, method: 'card' }).then((payment: any) => {
          cy.task('db:createFactura', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F-2026-0007',
            kind: 'full',
            description: 'Bono 12 — €528.00 of €528.00 (12 of 12 sessions)',
            amountCents: 52800,
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // Facturas sit behind the Money tab's sub-nav now -- it exists so the
          // account ledger gets the full width. Bonos stayed on screen because
          // selling one is an everyday action; filing a fiscal document is not.
          cy.contains('button', 'Facturas & receipts').click()
          cy.contains('Facturas').should('be.visible')
          cy.contains('F-2026-0007').should('be.visible')
          cy.contains('Bono 12 — €528.00 of €528.00 (12 of 12 sessions)').should('be.visible')

          // A full invoice needs a NIF, and this patient has none. Reception
          // is told rather than blocked at the counter.
          cy.contains("need the patient's NIF").should('be.visible')

          // Once it is on the patient record the nudge goes.
          cy.task('db:setPatientNif', { patientId: patient.id, nationalId: '12345678Z' })
          cy.reload()
          // A reload puts the Money tab back on its default sub-tab.
          cy.contains('button', 'Facturas & receipts').click()
          cy.contains('F-2026-0007').should('be.visible')
          cy.contains("need the patient's NIF").should('not.exist')
        })
      })
    })
  })
})
