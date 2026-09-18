// Asking the chain to prove itself.
//
// The registro de facturación is tamper-evident: alter a record and the
// huellas stop agreeing. But evidence nobody looks at is not evidence, and
// until verify_factura_chain there was nothing in the system that could
// actually look. This is that check, exercised through the same entry points
// the application uses.
//
// What is NOT tested here, deliberately: producing a huella_mismatch by
// editing a record. There is no application path that can, which is the whole
// point of the append-only trigger -- factura-record-chain.cy.ts proves the
// service role itself is refused. Detection of a genuinely edited record is
// verified against the database directly (see the migration); a test that
// needed a tampering backdoor would have to ship one.
describe('Verifying the registro de facturación', () => {
  // The Packages/bonos card renders skeletons until its own fetch lands, so
  // the select does not exist for the first moment the tab is open. The
  // default 4s is enough on an idle machine and not enough on a busy one --
  // which is a flake in the test, not a slow page.
  const sellBono = (name: string, label: string) => {
    cy.contains('select', 'Sell a package', { timeout: 30000 }).should('exist').select(label)
    cy.contains('button', /^Sell$/).click()
    cy.contains('button', 'Selling…', { timeout: 30000 }).should('not.exist')
    return cy.wrap(name, { log: false })
  }

  it('reports nothing wrong with a chain nobody has touched', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Verifica', lastName: 'Uno' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono V1', sessionCount: 4, priceCents: 20000 })
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono V2', sessionCount: 4, priceCents: 30000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('one', 'Bono V1 (4, €200.00)')
        sellBono('two', 'Bono V2 (4, €300.00)')

        cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((records: any) => {
          expect(records, 'two facturas, two records').to.have.length(2)
          // The label has to name the formula that actually produced the
          // huella. It once did not: the formula was corrected and every row
          // rebuilt, while the function writing new rows went on stamping the
          // superseded name -- a hash that was right under a label that was
          // wrong, on a fiscal record.
          expect(records[0].huella_spec_version).to.eq('aeat-0.1.2')
          expect(records[1].huella_spec_version).to.eq('aeat-0.1.2')
        })

        cy.task('db:verifyFacturaChain', { accountId: account.accountId }).then((problems: any) => {
          // A verifier that cried wolf on healthy chains would be worse than
          // none: nobody would read the report.
          expect(problems, 'a healthy chain verifies').to.deep.eq([])
        })
      })
    })
  })

  it('calls a chain awaiting rebuild stale, not altered', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Verifica', lastName: 'Dos' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: account.accountId, name: 'Bono V3', sessionCount: 4, priceCents: 25000 })

        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('one', 'Bono V3 (4, €250.00)')

        // Stamp the chain with a formula this database no longer implements
        // -- the state every record is in between a formula being corrected
        // and the rebuild running.
        cy.task('db:rebuildFacturaHuellas', { accountId: account.accountId, specVersion: 'aeat-0.0.9' })

        cy.task('db:verifyFacturaChain', { accountId: account.accountId }).then((problems: any) => {
          expect(problems).to.have.length(1)
          // The distinction that matters. Recomputing an old record with
          // today's formula gives a different digest every time, and calling
          // that huella_mismatch would accuse the clinic of altering invoices
          // it never touched.
          expect(problems[0].problem).to.eq('stale_spec_version')
          expect(problems[0].serie_number).to.match(/^F-/)
        })

        // And the rebuild puts it right, which is what makes the report
        // actionable rather than just alarming.
        cy.task('db:rebuildFacturaHuellas', { accountId: account.accountId, specVersion: 'aeat-0.1.2' })
        cy.task('db:verifyFacturaChain', { accountId: account.accountId }).then((problems: any) => {
          expect(problems, 'rebuilt, and clean').to.deep.eq([])
        })
      })
    })
  })

  it('hashes the contents, so an altered record could not agree with itself', () => {
    // What makes huella_mismatch worth checking at all: every field the
    // record carries is inside the digest. If the amount were outside it, a
    // record could be rewritten to say a different number and still verify.
    const base = {
      issuerNif: 'B12345678',
      serieNumber: 'F-2026-0001',
      issuedOn: '2026-09-18',
      invoiceType: 'F1',
      cuotaTotalCents: 0,
      importeTotalCents: 20000,
      previousHuella: null,
      generatedAt: '2026-09-18T10:00:00+02:00',
    }

    cy.task('db:huellaFor', base).then((original: any) => {
      const fields: Array<[string, Record<string, unknown>]> = [
        ['the amount', { importeTotalCents: 20001 }],
        ['the tax', { cuotaTotalCents: 1 }],
        ['the number', { serieNumber: 'F-2026-0002' }],
        ['the date', { issuedOn: '2026-09-19' }],
        ['the issuer', { issuerNif: 'B87654321' }],
        ['the invoice type', { invoiceType: 'F2' }],
        ['the predecessor', { previousHuella: 'A'.repeat(64) }],
        ['when it was recorded', { generatedAt: '2026-09-18T10:00:01+02:00' }],
      ]

      fields.forEach(([what, change]) => {
        cy.task('db:huellaFor', { ...base, ...change }).then((altered: any) => {
          expect(altered.huella, `${what} is covered by the huella`).to.not.eq(original.huella)
        })
      })
    })
  })
  it('will not tell an outsider, or the anon key, anything about a chain', () => {
    // verify_factura_chain is security definer: it reads whatever account_id
    // it is handed, so the account is the only thing standing between a
    // caller and another clinic's serie numbers.
    //
    // The guard first asked whether there was a user (auth.uid()), reasoning
    // that a caller without one must be a cron or an operator. An anonymous
    // PostgREST request has no user either, so it was waved through -- with
    // the anon key, which ships in the client bundle.
    cy.seedStaffAccount().then((owner) => {
      cy.task('db:createPatient', { accountId: owner.accountId, clinicId: owner.clinicId, firstName: 'Ajena', lastName: 'Tres' }).then((patient: any) => {
        cy.task('db:createPackageTemplate', { accountId: owner.accountId, name: 'Bono V4', sessionCount: 4, priceCents: 22000 })

        cy.login(owner.email, owner.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        sellBono('one', 'Bono V4 (4, €220.00)')

        // Nothing but the anon key.
        cy.task('db:verifyFacturaChainAs', { accountId: owner.accountId, as: 'anon' }).then((result: any) => {
          expect(result.refused, `anon was allowed to ask: ${JSON.stringify(result.rows)}`).to.be.true
        })

        // A real, signed-in user -- of somebody else's clinic. The case a
        // permission check passes by accident, because the caller looks
        // entirely legitimate.
        cy.seedStaffAccount().then((stranger) => {
          cy.task('db:verifyFacturaChainAs', {
            accountId: owner.accountId,
            as: 'outsider',
            email: stranger.email,
            password: stranger.password,
          }).then((result: any) => {
            expect(result.refused, `an outsider read the chain: ${JSON.stringify(result.rows)}`).to.be.true
          })

          // And their own account answers normally, so the refusal is about
          // the account rather than the function being broken for everyone.
          cy.task('db:verifyFacturaChain', { accountId: stranger.accountId }).then((problems: any) => {
            expect(problems).to.deep.eq([])
          })
        })
      })
    })
  })
})
