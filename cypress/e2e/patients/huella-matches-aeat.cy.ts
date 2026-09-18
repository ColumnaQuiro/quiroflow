// The huella is checked against AEAT's own worked example, not against itself.
//
// A hash chain that only agrees with the code that produced it proves nothing:
// it is consistent and wrong. The specification -- "Detalle de las
// especificaciones técnicas para generación de la huella o hash de los
// registros de facturación", v0.1.2, section 6.1 -- publishes an input and the
// hash it must produce, so that is what this asserts.
//
// It caught a real error: FechaHoraHusoGenRegistro had been written as UTC
// with a trailing Z, where the spec uses local time with an explicit offset.
// The same instant, a different string, a different hash, and every record
// written under the draft was wrong.
const AEAT_EXAMPLE = {
  issuerNif: '89890001K',
  serieNumber: '12345678/G33',
  issuedOn: '2024-01-01',
  invoiceType: 'F1',
  cuotaTotalCents: 1235,
  importeTotalCents: 12345,
  previousHuella: null,
  generatedAt: '2024-01-01T19:20:30+01:00',
}

const EXPECTED_INPUT =
  'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024' +
  '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=' +
  '&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00'

const EXPECTED_HUELLA = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60'

describe('The huella agrees with AEAT', () => {
  it('reproduces the exact string the specification concatenates', () => {
    cy.task('db:huellaFor', AEAT_EXAMPLE).then((result: any) => {
      // Asserted separately from the hash because when this breaks it is
      // nearly always the string, and a hash mismatch alone says nothing
      // about which field drifted.
      expect(result.input).to.eq(EXPECTED_INPUT)
    })
  })

  it('reproduces the hash the specification publishes for it', () => {
    cy.task('db:huellaFor', AEAT_EXAMPLE).then((result: any) => {
      expect(result.huella).to.eq(EXPECTED_HUELLA)
    })
  })

  it('chains a second record onto the first, as the spec requires', () => {
    cy.task('db:huellaFor', { ...AEAT_EXAMPLE, previousHuella: EXPECTED_HUELLA, serieNumber: '12345679/G33' }).then((result: any) => {
      // The predecessor's huella appears in the string rather than an empty
      // Huella=, which is the whole mechanism.
      expect(result.input).to.contain(`&Huella=${EXPECTED_HUELLA}&`)
      expect(result.huella).to.not.eq(EXPECTED_HUELLA)
      expect(result.huella).to.match(/^[0-9A-F]{64}$/)
    })
  })

  it('still refuses to let a stored record be altered', () => {
    // The rebuild path needed an exception to the append-only trigger, so the
    // guarantee has to be re-proven: without the rebuild flag set, an update
    // is still rejected, and a delete is rejected either way.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Sigue', lastName: 'Intacto' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono Z', sessionCount: 3, priceCents: 12000 })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono Z (3, €120.00)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          cy.task('db:tryMutateFacturaRecord', { id: records[0].id }).then((result: any) => {
            expect(result.updateBlocked, 'still append-only outside a rebuild').to.be.true
            expect(result.deleteBlocked, 'a record is never deletable').to.be.true
          })
        })
      })
    })
  })
})
