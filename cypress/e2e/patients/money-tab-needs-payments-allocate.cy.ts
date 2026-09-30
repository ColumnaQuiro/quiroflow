// Money in is a `payments` row, and RLS ("staff write payments", 0170) only
// lets someone write one with payments_allocate. The Money tab offered Take
// payment and Add credit on billing_access alone, so the seeded Practitioner
// role -- billing_access yes, payments_allocate no -- was shown both, and the
// database then refused the payment.
//
// Nothing on screen said so. The inserts' errors were never read: Take
// payment closed its panel as if the money had been taken, and Add credit
// went on to write its account_credits row (which RLS does allow on
// billing_access) with no payment behind it -- credit the patient never paid
// for, and no factura.
describe('Taking money on the Money tab', () => {
  const refused = {
    statusCode: 403,
    body: { code: '42501', message: 'new row violates row-level security policy for table "payments"', details: null, hint: null },
  }

  it('is not offered to a role without payments_allocate', () => {
    cy.seedStaffAccount().then((account) => {
      const email = `practitioner-${Date.now()}@example.test`
      cy.task<any>('db:createTeamMemberWithRole', {
        accountId: account.accountId,
        clinicId: account.clinicId,
        roleName: 'Practitioner',
        email,
        password: 'Test1234!',
        fullName: 'Pablo Practitioner',
      }).then((member) => {
        cy.task<any>('db:createPatient', {
          accountId: account.accountId,
          clinicId: account.clinicId,
          firstName: 'Olga',
          lastName: 'Owncare',
          defaultPractitionerId: member.teamMemberId,
        }).then((patient) => {
          cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })

          cy.login(email, 'Test1234!')
          cy.visit(`/patients/${patient.id}?tab=billing`)

          // The tab itself is still theirs to read. The permission comes
          // from the store, which is loaded before the page renders, so the
          // buttons are gated from the first paint.
          cy.contains('Owed now').should('be.visible')
          cy.contains('Owed now').parent().should('contain.text', '44,00')
          cy.contains('button', 'Take payment').should('not.exist')
          cy.contains('button', 'Add credit').should('not.exist')
        })
      })
    })
  })

  it('writes no credit when the payment behind it is refused', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rita', lastName: 'Refused' }).then((patient) => {
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        cy.contains('Owed now').should('be.visible')

        cy.intercept('POST', '**/rest/v1/payments*', refused).as('payment')
        cy.contains('button', 'Add credit').click()
        cy.get('input[type="number"]').first().clear().type('150')
        cy.get('button:contains("Add credit")').last().click()
        cy.wait('@payment')

        cy.contains('could not be recorded').should('be.visible')
        cy.task('db:creditsFor', { patientId: patient.id }).should('deep.eq', [])
      })
    })
  })

  it('keeps the payment panel open, with the error, when the payment is refused', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<any>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Rafa', lastName: 'Refused' }).then((patient) => {
        cy.task('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4400, status: 'unpaid' })
        cy.login(account.email, account.password)
        cy.visit(`/patients/${patient.id}?tab=billing`)
        // See payment-records-who-took-it: the invoice list must be in before
        // the panel snapshots it.
        cy.contains('INV-').should('exist')

        cy.intercept('POST', '**/rest/v1/payments*', refused).as('payment')
        cy.contains('button', 'Take payment').click()
        cy.contains('button', 'Record payment').parents('form').contains('button', 'Record payment').click()
        cy.wait('@payment')

        cy.contains('could not be recorded').should('be.visible')
        cy.contains('button', 'Record payment').should('be.visible')
        cy.task('db:facturasFor', { patientId: patient.id }).should('deep.eq', [])
      })
    })
  })
})
