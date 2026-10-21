// A minor's facturas in their tutor's name (patients.bill_to_tutor,
// fill_factura_recipient, 20261021173018): switched on in the patient's
// details, a factura issued afterwards is addressed to the tutor -- their name
// on the PDF, "A nombre de" in the billing tab -- and one issued before keeps
// the child's.
describe('Facturas in the tutor’s name', () => {
  it('addresses a minor’s new facturas to the tutor once it is switched on', () => {
    cy.seedStaffAccount().then((account) => {
      const mk = (first: string, extra: Record<string, unknown>) =>
        cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: first, lastName: 'Tutoria' }).then((p) =>
          cy.task('db:updateRows', { table: 'patients', values: extra, match: { id: p.id } }).then(() => p),
        )
      mk('Lucia', { national_id: '12345678Z' }).then((tutor) =>
        mk('Nico', { is_minor: true, tutor_patient_id: tutor.id }).then((child) => {
          const factura = (number: string) =>
            cy.task<{ id: string }>('db:createPayment', { accountId: account.accountId, patientId: child.id, amountCents: 50000, method: 'card' }).then((payment) =>
              cy.task<{ id: string }>('db:createFactura', { accountId: account.accountId, patientId: child.id, paymentId: payment.id, number, kind: 'full', description: 'Bono 10', amountCents: 50000 }),
            )
          // Before the option: the child's.
          factura('FC-T-0001').then((before) => {
            cy.task<any[]>('db:selectRows', { table: 'facturas', columns: 'recipient_patient_id', match: { id: before.id } }).its('0.recipient_patient_id').should('eq', null)
          })

          cy.login(account.email, account.password)
          cy.visit(`/patients/${child.id}`)
          cy.contains('button', 'Edit all details').click()
          cy.get('[data-cy=patient-bill-to-tutor]').check({ scrollBehavior: 'center' })
          cy.contains('button', 'Save').click({ scrollBehavior: 'center' })
          cy.contains('Patient saved').should('be.visible')
          cy.task<any[]>('db:selectRows', { table: 'patients', columns: 'bill_to_tutor', match: { id: child.id } }).its('0.bill_to_tutor').should('eq', true)

          // After: the tutor's, on the PDF and in the billing tab.
          factura('FC-T-0002').then((after) => {
            cy.task<any[]>('db:selectRows', { table: 'facturas', columns: 'recipient_patient_id', match: { id: after.id } }).its('0.recipient_patient_id').should('eq', tutor.id)
            cy.request({ url: `/api/facturas/${after.id}/pdf`, encoding: 'binary' }).then((res) => {
              cy.task<string[]>('pdf:text', { binary: res.body }).then((texts) => {
                const text = texts.join(' ')
                expect(text).to.contain('Lucia Tutoria').and.contain('12345678Z')
                expect(text).not.to.contain('Nico Tutoria')
              })
            })
            cy.visit(`/patients/${child.id}?tab=billing`)
            cy.get('[data-cy=factura-addressee]', { timeout: 20000 }).should('have.length', 1).and('contain', 'Lucia Tutoria')
          })
        }),
      )
    })
  })
})
