// The VERI*FACTU QR (Orden HAC/1177/2024 arts. 20-21): every factura issued
// by a system that sends to the AEAT carries it at the top, with "QR
// tributario:" above it and "VERI*FACTU" below. Its URL is unit-tested in
// tests/unit/verifactu-qr.test.ts; this is the document around it.
describe('The VERI*FACTU QR on a factura', () => {
  function facturaPdfText(account: any, number: string) {
    return cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Quique', lastName: 'Registro' }).then((patient) =>
      cy.task<any>('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4400, method: 'card' }).then((payment) =>
        cy
          .task<any>('db:createFactura', { accountId: account.accountId, patientId: patient.id, paymentId: payment.id, number, kind: 'simplified', description: 'Consulta', amountCents: 4400 })
          .then((factura) =>
            cy.request({ url: `/api/facturas/${factura.id}/pdf`, encoding: 'binary' }).then((res) => {
              expect(res.status).to.eq(200)
              return cy.task<string[]>('pdf:text', { binary: res.body }).then((texts) => texts.join(' '))
            }),
          ),
      ),
    )
  }

  it('is not printed on a test-period factura, even from a clinic that sends to the AEAT', () => {
    // A test-chain factura is still a real patient's document: its QR would
    // open the AEAT's test portal, and "VERI*FACTU" would claim a status it
    // does not have yet.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setClinicFiscal', { clinicId: account.clinicId, taxId: 'B12345678', legalName: 'Clinica Prueba SL' })
      cy.task('db:setVerifactuMode', { accountId: account.accountId, mode: 'test' })
      cy.login(account.email, account.password)
      facturaPdfText(account, 'F-2026-0101').then((text) => {
        expect(text).not.to.contain('QR tributario')
        expect(text).not.to.contain('VERI*FACTU')
      })
    })
  })

  it('is printed on a live clinic’s real factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setClinicFiscal', { clinicId: account.clinicId, taxId: 'B12345678', legalName: 'Clinica Prueba SL' })
      // Live, with the first production record already issued.
      cy.task('db:startProductionChain', { accountId: account.accountId, clinicId: account.clinicId })
      cy.login(account.email, account.password)
      facturaPdfText(account, 'F-2027-0002').then((text) => {
        expect(text).to.contain('QR tributario:')
        expect(text).to.contain('VERI*FACTU')
      })
    })
  })

  it('is not printed while the clinic has VeriFactu off: nothing is registered for it to find', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:setClinicFiscal', { clinicId: account.clinicId, taxId: 'B12345678', legalName: 'Clinica Prueba SL' })
      cy.login(account.email, account.password)
      facturaPdfText(account, 'F-2026-0102').then((text) => {
        expect(text).not.to.contain('QR tributario')
        expect(text).not.to.contain('VERI*FACTU')
      })
    })
  })
})
