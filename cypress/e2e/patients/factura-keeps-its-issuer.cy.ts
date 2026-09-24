// A factura prints the issuer it was issued by, not the clinic as it is today.
//
// The PDF used to read name, legal name, address, NIF and footer from
// `clinics` on every render. So a clinic that moved, or corrected its NIF in
// Settings -> Fiscal Data, silently rewrote every factura it had ever issued
// the next time one was downloaded or re-sent -- on a chain-signed fiscal
// record. It also always used the account's oldest clinic, so a visit at a
// second location was invoiced under the first one's name and address.
//
// The assertions read the PDF's own text, because the document is the thing
// the patient keeps: a snapshot column that the renderer ignored would pass
// a check on the row.
function pdfTextOf(facturaId: string) {
  return cy
    .request({ url: `/api/facturas/${facturaId}/pdf`, encoding: 'binary' })
    .then((res) => {
      expect(res.status).to.eq(200)
      return cy.task('pdf:text', { binary: res.body })
    })
    .then((texts) => (texts as string[]).join('\n'))
}

describe('A factura keeps its issuer', () => {
  it('still prints the old address and NIF after the clinic changes them', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', {
        clinicId: account.clinicId,
        name: 'Quiro Centro',
        legalName: 'Quiro Vieja S.L.',
        address: 'Calle Vieja 1, 46001 Valencia',
        taxId: 'B11111111',
      })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Emi', lastName: 'Sora' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono 5', sessionCount: 5, priceCents: 22000 })

        // Issued the way the desk issues one, so the snapshot is taken on the
        // real path and not only on a seeded insert.
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('select', 'Sell a package').should('exist').select('Bono 5 (5, 220,00\u00a0€)')
        cy.contains('button', /^Sell$/).click()
        cy.contains('button', 'Selling…').should('not.exist')

        cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
          expect(rows).to.have.length(1)
          const factura = rows[0]
          expect(factura.issuer_address).to.eq('Calle Vieja 1, 46001 Valencia')
          expect(factura.issuer_tax_id).to.eq('B11111111')

          pdfTextOf(factura.id).then((text) => {
            expect(text).to.contain('Calle Vieja 1, 46001 Valencia')
            expect(text).to.contain('B11111111')
            expect(text).to.contain('Quiro Vieja S.L.')
          })

          // The clinic moves and corrects its fiscal data.
          cy.task('db:updateClinic', {
            clinicId: account.clinicId,
            legalName: 'Quiro Nueva S.L.',
            address: 'Avenida Nueva 99, 46002 Valencia',
            taxId: 'B22222222',
          })

          // The factura already handed over does not follow it.
          pdfTextOf(factura.id).then((text) => {
            expect(text, 'the address it was issued with').to.contain('Calle Vieja 1, 46001 Valencia')
            expect(text).to.contain('B11111111')
            expect(text).to.contain('Quiro Vieja S.L.')
            expect(text, 'not the address the clinic has now').not.to.contain('Avenida Nueva 99')
            expect(text).not.to.contain('B22222222')
            expect(text).not.to.contain('Quiro Nueva S.L.')
          })

          // The printed NIF is the one the registro hashed as IDEmisorFactura.
          // They come from the same lookup in the same transaction; if they
          // ever diverge, the document and the AEAT record name different
          // issuers.
          cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
            const record = records.find((r: any) => r.factura_id === factura.id)
            expect(record.issuer_nif).to.eq(factura.issuer_tax_id)
          })

          // And a factura issued from now on carries the new details.
          cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4500, method: 'cash' }).then((payment: any) => {
            cy.task('db:createFactura', {
              accountId: account.accountId,
              patientId: patient.id,
              paymentId: payment.id,
              number: 'F-2026-7702',
              description: 'Consulta',
              amountCents: 4500,
            }).then((later: any) => {
              pdfTextOf(later.id).then((text) => {
                expect(text).to.contain('Avenida Nueva 99, 46002 Valencia')
                expect(text).to.contain('B22222222')
              })
            })
          })
        })
      })
    })
  })

  it("names the visit's clinic on a multi-clinic account, under the account's NIF", () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', { clinicId: account.clinicId, name: 'Sede Sur', address: 'Calle Sur 1', taxId: 'B11111111', legalName: 'Quiro S.L.' })
      cy.task('db:createClinic', { accountId: account.accountId, name: 'Sede Norte', address: 'Calle Norte 5', taxId: 'B99999999' }).then((north: any) => {
        cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Norte' }).then((patient: any) => {
          cy.task('db:createAppointment', {
            accountId: account.accountId,
            clinicId: north.id,
            patientId: patient.id,
            startsAt: new Date(Date.now() - 86400000).toISOString(),
            status: 'completed',
          }).then((appt: any) => {
            cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4500, appointmentId: appt.id }).then((invoice: any) => {
              cy.task('db:createPayment', { accountId: account.accountId, invoiceId: invoice.id, amountCents: 4500, method: 'card' }).then((payment: any) => {
                cy.task('db:createFactura', {
                  accountId: account.accountId,
                  patientId: patient.id,
                  paymentId: payment.id,
                  number: 'F-2026-7703',
                  description: 'Consulta',
                  amountCents: 4500,
                })

                cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
                  const factura = rows[0]
                  // The establishment is where the visit happened...
                  expect(factura.issuer_clinic_id).to.eq(north.id)
                  expect(factura.issuer_name).to.eq('Sede Norte')
                  expect(factura.issuer_address).to.eq('Calle Norte 5')
                  // ...but the obligado is the account: the NIF the chain
                  // hashes and the AEAT is told about, not the second
                  // location's own.
                  expect(factura.issuer_tax_id).to.eq('B11111111')
                  expect(factura.issuer_legal_name).to.eq('Quiro S.L.')

                  cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
                    expect(records[0].issuer_nif).to.eq('B11111111')
                  })

                  cy.login(account.email, account.password)
                  pdfTextOf(factura.id).then((text) => {
                    expect(text).to.contain('Sede Norte')
                    expect(text).to.contain('Calle Norte 5')
                    expect(text).not.to.contain('Calle Sur 1')
                    expect(text).to.contain('B11111111')
                    expect(text).not.to.contain('B99999999')
                  })
                })
              })
            })
          })
        })
      })
    })
  })

  it('refuses to rewrite the issuer of a factura once issued', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:updateClinic', { clinicId: account.clinicId, address: 'Calle Fija 3' })
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Fija', lastName: 'Firme' }).then((patient: any) => {
        cy.task('db:createPayment', { accountId: account.accountId, patientId: patient.id, amountCents: 4500, method: 'cash' }).then((payment: any) => {
          cy.task('db:createFactura', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F-2026-7704',
            description: 'Consulta',
            amountCents: 4500,
          }).then((factura: any) => {
            // Even the service role: a wrong issuer is corrected with a
            // rectificativa, not by editing an issued document.
            cy.task('db:tryChangeFacturaIssuer', { facturaId: factura.id, address: 'Somewhere Else' }).then((res: any) => {
              expect(res.error).to.match(/cannot be changed/)
            })
            cy.task('db:facturasFor', { patientId: patient.id }).then((rows: any) => {
              expect(rows[0].issuer_address).to.eq('Calle Fija 3')
            })
          })
        })
      })
    })
  })
})
