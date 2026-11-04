import { bonoOwedCents } from '../../../utils/bonoOwed'

// A bono instalment Stripe takes on autopay is money FOR THE BONO, recorded
// the way one taken at the desk is: a payment on the bono, no invoice, no
// credit row.
//
// The webhook used to raise a paid invoice for the instalment and hang the
// payment off it, plus an account_credits top-up -- the bono model
// 20260914150556 and 0161 retired everywhere else. Two things followed:
//
//   - the instalment paid an invoice of its own instead of the sessions. Each
//     visit drawn from a bono raises its own charge, and the bono money is what
//     settles it; spent on a second charge for the same sessions, the last
//     visits of the bono read as unpaid. One patient's migrated Bono 12 showed
//     "88,00 EUR due" for two of its own sessions that way;
//   - the payment named no bono, so the card went on saying the instalment was
//     owed after Stripe had taken it.
//
// The case this is for is the one every PracticeHub clinic arrives with: a
// bono bought half-paid, the rest put on autopay from "No card on file -- add
// one to enable autopay for the remaining balance".
describe('A bono instalment paid through Stripe autopay', () => {
  it('pays the bono itself: no invoice of its own, no credit row, and the bono stops reading as owed', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Bea', lastName: 'Bonoplazos' }).then((patient) => {
        const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
        const subscriptionId = `sub_cypress_${stamp}`
        const webhookSecret = `whsec_cypress_${stamp}`

        cy.task<{ bonoId: string }>('auto:bonoOnStripe', {
          accountId: account.accountId,
          patientId: patient.id,
          subscriptionId,
          webhookSecret,
          priceCents: 52800,
          owedCents: 26400,
        }).then(({ bonoId }) => {
          const body = JSON.stringify({
            id: `evt_cypress_${stamp}`,
            object: 'event',
            type: 'invoice.paid',
            data: {
              object: {
                object: 'invoice',
                id: `in_cypress_${stamp}`,
                subscription: subscriptionId,
                payment_intent: `pi_cypress_${stamp}`,
                amount_paid: 26400,
                amount_due: 26400,
                period_start: Math.floor(Date.now() / 1000),
              },
            },
          })
          cy.task<{ header: string }>('auto:signStripe', { body, secret: webhookSecret }).then(({ header }) => {
            cy.request({
              method: 'POST',
              url: `/api/stripe/webhook/${account.accountId}`,
              body,
              headers: { 'content-type': 'application/json', 'stripe-signature': header },
            })
              .its('body')
              .should('deep.eq', { received: true })
          })

          cy.task<any[]>('db:paymentsFor', { patientId: patient.id }).then((payments) => {
            expect(payments.map((p) => [p.amount_cents, p.method, p.purpose, p.invoice_id, p.package_purchase_id])).to.deep.eq([
              [26400, 'card', 'bono', null, bonoId],
            ])

            // What the bono card and the Debtors report read.
            expect(
              bonoOwedCents({
                purchaseId: bonoId,
                invoiceId: null,
                priceCents: 52800,
                owedCents: 26400,
                invoice: null,
                payments: payments.map((p) => ({ ...p, external_reference: null })),
              }),
            ).to.eq(0)
          })
          // Nothing charged for it: the visits drawn from the bono are the charges.
          cy.task<any[]>('db:invoicesFor', { patientId: patient.id }).should('deep.eq', [])
          cy.task<any[]>('db:creditsFor', { patientId: patient.id }).should('deep.eq', [])
          // Still documented: money in gets its factura.
          cy.task<any[]>('db:facturasFor', { patientId: patient.id }).its('length').should('eq', 1)
          cy.task<any>('db:stripeScheduleState', { subscriptionId }).its('installmentsPaid').should('eq', 1)
        })
      })
    })
  })
})
