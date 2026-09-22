// Deleting a patient record, and the case where it cannot be done.
//
// The old flow was a browser confirm() that named two counts and then fired
// the delete. For most of a clinic's patients that worked. For any patient
// who had ever been handed a factura it did not, and the failure was raw:
// facturas.patient_id cascades, but factura_records.factura_id is RESTRICT,
// so Postgres refuses the whole statement and the screen showed
//
//   update or delete on table "facturas" violates foreign key constraint
//   "factura_records_factura_id_fkey" on table "factura_records"
//
// The restriction is right -- a factura_record is a chain-signed link in the
// VeriFactu sequence and removing one invalidates every record after it --
// so the fix is not to loosen the FK. It is for the dialog to know, and to
// say so before the clinic presses anything.
describe('Deleting a patient', () => {
  it('refuses a patient who holds an issued factura, and offers to archive', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Felipa',
        lastName: 'Facturada',
      }).then((patient: any) => {
        cy.task('db:createPayment', {
          accountId: account.accountId,
          patientId: patient.id,
          amountCents: 4400,
          method: 'card',
        }).then((payment: any) => {
          cy.task('db:createFactura', {
            accountId: account.accountId,
            patientId: patient.id,
            paymentId: payment.id,
            number: 'F2026-0001',
            description: 'Sesion',
            amountCents: 4400,
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${patient.id}`)

          cy.get('button[aria-label="More actions"]').click()
          cy.contains('button', 'Delete patient').click()

          // No confirm field to type into: there is nothing to confirm.
          cy.contains('This record cannot be deleted').should('be.visible')
          cy.contains('VeriFactu').should('be.visible')
          cy.contains('button', 'Delete permanently').should('not.exist')

          // The way out that does what the clinic actually wanted.
          cy.contains('button', 'Archive instead').click()
          cy.contains('Patient archived').should('be.visible')
          cy.contains('Archived').should('be.visible')

          // And the record is still there, which is the whole point.
          cy.location('pathname').should('eq', `/patients/${patient.id}`)
        })
      })
    })
  })

  it('deletes a patient with nothing fiscal attached, once the name is typed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task('db:createPatient', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        firstName: 'Nuria',
        lastName: 'Nueva',
      }).then((patient: any) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}`)

        cy.get('button[aria-label="More actions"]').click()
        cy.contains('button', 'Delete patient').click()

        cy.contains('Delete Nuria Nueva?').should('be.visible')
        // Armed only by the full name -- the old confirm() took any keypress.
        cy.contains('button', 'Delete permanently').should('be.disabled')
        cy.get('input[type="text"]').last().type('Nuria Nueva')
        cy.contains('button', 'Delete permanently').should('not.be.disabled').click()

        cy.location('pathname', { timeout: 15000 }).should('eq', '/patients')
        cy.task('db:patientByName', { accountId: account.accountId, firstName: 'Nuria', lastName: 'Nueva' }).should('eq', null)
      })
    })
  })
})
