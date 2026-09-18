// Knowing which records the AEAT actually holds.
//
// The chain proves the records were not altered. It says nothing about
// whether they were ever sent -- and under VERI*FACTU, sending them IS the
// obligation. A clinic whose records are immaculate and untransmitted is not
// compliant, and until this existed nothing could tell the two apart.
//
// The sender does not exist yet (it needs a qualified certificate). What is
// tested here is the consequence of each answer the AEAT can give, because
// that is the part that is easy to get wrong quietly and expensive to
// discover later.
describe('Records that know whether the AEAT took them', () => {
  const sellBono = (label: string) => {
    cy.contains('select', 'Sell a package', { timeout: 30000 }).should('exist').select(label)
    cy.contains('button', /^Sell$/).click()
    cy.contains('button', 'Selling…', { timeout: 30000 }).should('not.exist')
  }

  it('counts every record as outstanding until the AEAT answers', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Envio', lastName: 'Uno' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E1', sessionCount: 4, priceCents: 20000 })
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E2', sessionCount: 4, priceCents: 30000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('Bono E1 (4, €200.00)')
        sellBono('Bono E2 (4, €300.00)')

        cy.task('db:awaitingAeat', { accountId: account.accountId }).then((outstanding: any) => {
          // Issued is not sent. Both records are owed to the AEAT.
          expect(outstanding, 'nothing transmitted yet').to.have.length(2)
          expect(outstanding[0].attempts, 'never attempted').to.eq(0)
          expect(outstanding[0].last_status).to.eq(null)

          // Chain order, because a record whose predecessor the AEAT has not
          // seen is a gap that only surfaces later.
          expect(outstanding[0].sequence).to.be.lessThan(outstanding[1].sequence)
        })
      })
    })
  })

  it('treats "accepted with errors" as held by the AEAT, and rejection as not', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Envio', lastName: 'Dos' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E3', sessionCount: 4, priceCents: 21000 })
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E4', sessionCount: 4, priceCents: 22000 })
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E5', sessionCount: 4, priceCents: 23000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('Bono E3 (4, €210.00)')
        sellBono('Bono E4 (4, €220.00)')
        sellBono('Bono E5 (4, €230.00)')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          expect(records).to.have.length(3)
          const [plain, withErrors, rejected] = records

          cy.task('db:recordAeatSubmission', {
            accountId: account.accountId,
            facturaRecordId: plain.id,
            status: 'Correcto',
            csv: 'A-CSV-FROM-AEAT',
          })

          // The one that matters. "Accepted with errors" is REGISTERED at the
          // AEAT. Re-sending it as a new alta would duplicate a record they
          // already hold, so it must count as settled even though it carries
          // an error code -- the correction for it is a subsanación, which is
          // a different operation entirely.
          cy.task('db:recordAeatSubmission', {
            accountId: account.accountId,
            facturaRecordId: withErrors.id,
            status: 'AceptadoConErrores',
            csv: 'ANOTHER-CSV',
            errorCode: '2004',
            errorMessage: 'Valor no permitido en un campo no determinante',
          })

          // Rejected is the opposite: the AEAT does not have it, so it is
          // still owed and goes again as an ordinary alta.
          cy.task('db:recordAeatSubmission', {
            accountId: account.accountId,
            facturaRecordId: rejected.id,
            status: 'Incorrecto',
            errorCode: '1100',
            errorMessage: 'Valor o tipo incorrecto del campo',
          })

          cy.task('db:awaitingAeat', { accountId: account.accountId }).then((outstanding: any) => {
            expect(outstanding, 'only the rejected record is still owed').to.have.length(1)
            expect(outstanding[0].factura_record_id).to.eq(rejected.id)
            expect(outstanding[0].last_status).to.eq('Incorrecto')
            expect(outstanding[0].last_error_code).to.eq('1100')
            expect(outstanding[0].attempts).to.eq(1)
          })

          // Sending it again, successfully, settles it.
          cy.task('db:recordAeatSubmission', {
            accountId: account.accountId,
            facturaRecordId: rejected.id,
            attempt: 2,
            status: 'Correcto',
            csv: 'CSV-AFTER-FIX',
          })

          cy.task('db:awaitingAeat', { accountId: account.accountId }).then((outstanding: any) => {
            expect(outstanding, 'nothing owed once the AEAT holds them all').to.deep.eq([])
          })
        })
      })
    })
  })

  it('does not count a record as sent because the attempt never arrived', () => {
    // A transport error is not a rejection: nothing was judged, so the
    // payload may be perfectly good. Collapsing the two would either hide a
    // bad record or throw away a good one.
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Envio', lastName: 'Tres' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono E6', sessionCount: 4, priceCents: 24000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('Bono E6 (4, €240.00)')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          cy.task('db:recordAeatSubmission', {
            accountId: account.accountId,
            facturaRecordId: records[0].id,
            status: 'transport_error',
            errorMessage: 'socket hang up',
          })

          cy.task('db:awaitingAeat', { accountId: account.accountId }).then((outstanding: any) => {
            expect(outstanding, 'still owed -- the AEAT never saw it').to.have.length(1)
            expect(outstanding[0].last_status).to.eq('transport_error')
            expect(outstanding[0].attempts).to.eq(1)
          })
        })
      })
    })
  })

  it('keeps the transmission log out of reach of another clinic', () => {
    // factura_records_awaiting_aeat is security definer and takes an
    // account_id, which is the same shape that leaked the chain verifier
    // before it was fixed. Asserted here so it cannot regress quietly.
    cy.seedStaffAccount().then((owner) => {
      cy.task('db:createPatient', { accountId: owner.accountId, clinicId: owner.clinicId, firstName: 'Envio', lastName: 'Cuatro' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: owner.accountId, name: 'Bono E7', sessionCount: 4, priceCents: 25000 })

        cy.login(owner.email, owner.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('Bono E7 (4, €250.00)')

        cy.seedStaffAccount().then((stranger) => {
          cy.task('db:verifyFacturaChainAs', {
            accountId: owner.accountId,
            as: 'outsider',
            email: stranger.email,
            password: stranger.password,
          }).then((result: any) => {
            expect(result.refused, 'the chain stays private').to.be.true
          })

          cy.task('db:awaitingAeatAs', {
            accountId: owner.accountId,
            as: 'outsider',
            email: stranger.email,
            password: stranger.password,
          }).then((result: any) => {
            expect(result.refused, `an outsider read the transmission log: ${JSON.stringify(result.rows)}`).to.be.true
          })

          cy.task('db:awaitingAeatAs', { accountId: owner.accountId, as: 'anon' }).then((result: any) => {
            expect(result.refused, 'anon was allowed to ask').to.be.true
          })
        })
      })
    })
  })
})
