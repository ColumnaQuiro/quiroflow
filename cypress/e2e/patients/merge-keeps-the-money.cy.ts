// Merging two records for one person must move their money, not delete it.
//
// `merge_patients` moves each child table off the duplicate by hand and then
// deletes the row, on the reasoning that "nothing points at the duplicate any
// more, so the cascade has nothing left to take". `payments` gained its
// `patient_id` after that function was written and was never added to the
// list, so the cascade did have something to take:
//
//   payments_before_on_duplicate | 2
//   merged                       | t
//   payments_on_survivor_after   | 0
//
// It reported success. The front desk saw two records become one and the
// money that had been on the duplicate was gone -- which is the exact
// opposite of what merge promises, and invisible from the screen.
//
// `facturas` was missing from the same list too, but failed loudly instead
// (factura_records.factura_id is RESTRICT), so merging anyone holding one has
// been impossible rather than destructive.
//
// This drives the real modal rather than the RPC, because the RPC returns its
// per-table counts and the counts were never wrong -- `payments` simply was
// not among the keys. Only asking the database afterwards catches that.
describe('Merging two records for one person', () => {
  it('carries the payments and the facturas onto the survivor', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Paloma',
        lastName: 'Superviviente',
      }).then((survivor: any) => {
        cy.task('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Paloma',
          lastName: 'Duplicada',
        }).then((duplicate: any) => {
          // The money sits entirely on the record that is about to be deleted
          // -- the case the PracticeHub import left 18 of.
          cy.task('db:createPayment', {
            accountId: account.accountId,
            patientId: duplicate.id,
            amountCents: 5000,
            method: 'cash',
          }).then((payment: any) => {
            cy.task('db:createPayment', {
              accountId: account.accountId,
              patientId: duplicate.id,
              amountCents: 7500,
              method: 'card',
            })
            cy.task('db:createFactura', {
              accountId: account.accountId,
              patientId: duplicate.id,
              paymentId: payment.id,
              number: 'F2026-0001',
              description: 'Sesion',
              amountCents: 5000,
            })

            // The chain as it stood before the merge. Repointing patient_id
            // must not disturb it: the patient is not one of the hashed
            // fields, so every huella has to come out byte-identical.
            cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((before: any) => {
              cy.login(account.email, account.password)
              cy.visit(`/patients/${survivor.id}`)

              cy.get('button[aria-label="More actions"]').click()
              cy.contains('button', 'Merge with another record').click()

              cy.get('#merge-search').type('Duplicada')
              cy.contains('button', 'Paloma Duplicada').click()

              // The record opened is the one kept, which is the default.
              cy.contains('Keeps everything').should('be.visible')
              cy.contains('button', 'Merge').click()
              cy.contains('Patients merged').should('be.visible')

              // The duplicate is gone -- the merge really did happen, so a
              // passing assertion below is not just the delete having failed.
              cy.task('db:patientByName', {
                accountId: account.accountId,
                firstName: 'Paloma',
                lastName: 'Duplicada',
              }).should('eq', null)

              cy.task('db:paymentsFor', { patientId: survivor.id }).then((payments: any) => {
                expect(payments.map((p: any) => p.amount_cents).sort()).to.deep.eq([5000, 7500])
              })

              cy.task('db:facturasFor', { patientId: survivor.id }).then((facturas: any) => {
                expect(facturas).to.have.length(1)
                expect(facturas[0].number).to.eq('F2026-0001')
              })

              cy.task('db:facturaRecordsFor', { accountId: account.accountId }).then((after: any) => {
                expect(after.map((r: any) => r.huella)).to.deep.eq(before.map((r: any) => r.huella))
              })
            })
          })
        })
      })
    })
  })
})
