import type { StaffAccount } from '../../support/commands'

// "Pagar" in the patient app: a Stripe Checkout page for what is still owed on
// one of the patient's own unpaid invoices. Opening the page needs the
// clinic's Stripe, which CI does not have, so this covers everything decided
// before Stripe is asked: whose invoice it is, whether anything is owed, and
// whether the clinic takes card payments at all. The webhook that records
// the money is online booking's, unchanged.

interface Seeded { account: StaffAccount; token: string; mine: string; paid: string; theirs: string }

function seed(): Cypress.Chainable<Seeded> {
  const email = `patient-pays-${Date.now()}@example.test`
  const password = 'valencia2026'
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Irene', lastName: 'Bosch' }).then((me) =>
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Tomás', lastName: 'Vidal' }).then((other) => {
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: me.id, email, password })
        return cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: me.id, totalCents: 4500, status: 'unpaid' }).then((mine) =>
          cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: me.id, totalCents: 4500, status: 'paid' }).then((paid) =>
            cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: other.id, totalCents: 4500, status: 'unpaid' }).then((theirs) =>
              cy.task<string>('db:accessTokenFor', { email, password }).then((token) => cy.wrap({ account, token, mine: mine.id, paid: paid.id, theirs: theirs.id })),
            ),
          ),
        )
      }),
    ),
  )
}

describe('A patient paying their own invoice', () => {
  it('is offered only where the clinic takes card payments, and only for what is theirs and owed', () => {
    seed().then(({ account, token, mine, paid, theirs }) => {
      const auth = { Authorization: `Bearer ${token}` }
      const payLink = (invoiceId: string) => cy.request({ method: 'POST', url: '/api/portal/invoices/pay-link', headers: auth, body: { invoiceId }, failOnStatusCode: false })

      // No Stripe on the clinic: not offered, and refused if asked anyway.
      cy.request({ url: '/api/portal/invoices/payable', headers: auth }).its('body.enabled').should('eq', false)
      payLink(mine).then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.statusMessage).to.contain('not configured')
      })

      cy.task('db:setStripePublishableKey', { accountId: account.accountId, key: 'pk_test_patient_pays' })
      cy.request({ url: '/api/portal/invoices/payable', headers: auth }).its('body.enabled').should('eq', true)

      // Someone else's invoice does not exist, as far as this patient can tell.
      payLink(theirs).its('status').should('eq', 404)
      // Nothing to pay on a settled one.
      payLink(paid).then((res) => {
        expect(res.status).to.eq(400)
        expect(res.body.statusMessage).to.eq('This invoice is already settled.')
      })
    })
  })

  it('needs a signed-in patient', () => {
    cy.request({ url: '/api/portal/invoices/payable', failOnStatusCode: false }).its('status').should('eq', 401)
  })
})
