// Stripe delivers webhooks at least once, not exactly once: a slow response,
// a timeout or a manual "Resend" from the dashboard all deliver the same
// invoice.paid again. The handler kept no record of which Stripe invoices it
// had already booked, so every redelivery raised another paid invoice, another
// card payment and another factura in the fiscal series for the same money,
// and counted the instalment again (installments_paid, read then written).
//
// And since Stripe's 2025-03-31.basil API, an invoice no longer carries
// `subscription` or `payment_intent` at the top level: they live at
// parent.subscription_details.subscription and payments[].payment. The
// handler read only the old fields, so on an endpoint on a current API version
// the subscription resolved to nothing and the instalment was never recorded
// at all.
describe('An autopay instalment paid through Stripe', () => {
  function deliver(accountId: string, secret: string, invoice: Record<string, unknown>) {
    const body = JSON.stringify({
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      object: 'event',
      type: 'invoice.paid',
      data: { object: { object: 'invoice', amount_paid: 4000, amount_due: 4000, period_start: Math.floor(Date.now() / 1000), ...invoice } },
    })
    return cy.task<{ header: string }>('auto:signStripe', { body, secret }).then(({ header }) =>
      cy
        .request({
          method: 'POST',
          url: `/api/stripe/webhook/${accountId}`,
          body,
          headers: { 'content-type': 'application/json', 'stripe-signature': header },
        })
        .its('body')
        .should('deep.eq', { received: true }),
    )
  }

  function memberOnStripe() {
    return cy.seedStaffAccount().then((account) =>
      cy
        .task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Mila', lastName: 'Mensual' })
        .then((patient) => {
          const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
          const subscriptionId = `sub_cypress_${stamp}`
          const webhookSecret = `whsec_cypress_${stamp}`
          return cy
            .task('auto:membershipOnStripe', { accountId: account.accountId, patientId: patient.id, subscriptionId, webhookSecret })
            .then(() => ({ account, patient, subscriptionId, webhookSecret, stamp }))
        }),
    )
  }

  it('books the same Stripe invoice once, however many times it is delivered', () => {
    memberOnStripe().then(({ account, patient, subscriptionId, webhookSecret, stamp }) => {
      const invoice = { id: `in_cypress_${stamp}`, subscription: subscriptionId, payment_intent: `pi_cypress_${stamp}` }
      deliver(account.accountId, webhookSecret, invoice)
      deliver(account.accountId, webhookSecret, invoice)

      cy.task<any[]>('db:paymentsFor', { patientId: patient.id }).then((payments) => {
        expect(payments.map((p) => p.amount_cents)).to.deep.eq([4000])
      })
      cy.task<any[]>('db:invoicesFor', { patientId: patient.id }).then((invoices) => {
        expect(invoices.map((i) => i.status)).to.deep.eq(['paid'])
      })
      cy.task<any[]>('db:facturasFor', { patientId: patient.id }).its('length').should('eq', 1)
      cy.task<any>('db:stripeScheduleState', { subscriptionId }).then((state) => {
        expect(state.installmentsPaid).to.eq(1)
        expect(state.events.filter((e: any) => e.status === 'paid')).to.have.length(1)
      })
    })
  })

  it('reads the subscription and payment intent from a current-API invoice', () => {
    memberOnStripe().then(({ account, patient, subscriptionId, webhookSecret, stamp }) => {
      deliver(account.accountId, webhookSecret, {
        id: `in_cypress_${stamp}`,
        parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionId } },
        payments: {
          object: 'list',
          data: [{ object: 'invoice_payment', status: 'paid', payment: { type: 'payment_intent', payment_intent: `pi_cypress_${stamp}` } }],
        },
      })

      cy.task<any[]>('db:paymentsFor', { patientId: patient.id }).then((payments) => {
        expect(payments.map((p) => p.amount_cents)).to.deep.eq([4000])
      })
      cy.task<any>('db:stripeScheduleState', { subscriptionId }).then((state) => {
        expect(state.installmentsPaid).to.eq(1)
        expect(state.events.map((e: any) => e.stripe_payment_intent_id)).to.deep.eq([`pi_cypress_${stamp}`])
      })
    })
  })
})
