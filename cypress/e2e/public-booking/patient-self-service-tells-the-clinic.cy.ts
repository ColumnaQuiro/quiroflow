// What a patient now does on their own -- joining the waitlist, paying an
// invoice online -- reaches the clinic as a push (staffPush.ts
// pushPatientAction). The push itself needs Firebase, which CI does not
// have; these cover the paths that send it, which must still do their job
// first and only once.

describe('A patient acting on their own', () => {
  it('joins the waitlist through the server, once, marked as their own', () => {
    const email = `waitlist-route-${Date.now()}@example.test`
    const password = 'valencia2026'
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Elena', lastName: 'Ruiz' }).then((patient) => {
        // Also lets the clinic's patients book from the app, which joining needs.
        cy.task('db:givePatientAppLogin', { accountId: account.accountId, patientId: patient.id, email, password })
        cy.task<string>('db:accessTokenFor', { email, password }).then((token) => {
          const join = () => cy.request({ method: 'POST', url: '/api/portal/waitlist/join', headers: { Authorization: `Bearer ${token}` }, body: { clinicId: account.clinicId } })
          join().its('body').then((first: { entryId: string; created: boolean }) => {
            expect(first.created).to.eq(true)
            // A second tap tells nobody again and makes no second entry.
            join().its('body').should('deep.eq', { entryId: first.entryId, created: false })
            cy.task<{ status: string; source: string | null }>('db:waitlistEntryById', { id: first.entryId }).then((entry) => {
              expect(entry.status).to.eq('waiting')
              expect(entry.source).to.eq('patient')
            })
          })
        })
      })
    })
  })

  it('pays an invoice online: recorded once, the invoice paid, one factura', () => {
    cy.seedStaffAccount().then((account) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Pablo', lastName: 'Gil' }).then((patient) => {
        const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
        const webhookSecret = `whsec_cypress_${stamp}`
        cy.task('auto:membershipOnStripe', { accountId: account.accountId, patientId: patient.id, subscriptionId: `sub_cypress_${stamp}`, webhookSecret })
        cy.task<{ id: string }>('db:createInvoice', { accountId: account.accountId, patientId: patient.id, totalCents: 4500, status: 'unpaid' }).then((invoice) => {
          // What Stripe sends after "Pagar": the PaymentIntent carries the
          // invoice and source patient_pay (pay-link.post.ts).
          const body = JSON.stringify({
            id: `evt_${stamp}`,
            object: 'event',
            type: 'payment_intent.succeeded',
            data: { object: { id: `pi_cypress_${stamp}`, object: 'payment_intent', amount_received: 4500, metadata: { invoice_id: invoice.id, account_id: account.accountId, source: 'patient_pay' } } },
          })
          const deliver = () =>
            cy.task<{ header: string }>('auto:signStripe', { body, secret: webhookSecret }).then(({ header }) =>
              cy.request({ method: 'POST', url: `/api/stripe/webhook/${account.accountId}`, body, headers: { 'content-type': 'application/json', 'stripe-signature': header } }).its('body').should('deep.eq', { received: true }),
            )
          deliver()
          deliver()
          cy.task<{ amount_cents: number; method: string; purpose: string }[]>('db:paymentsFor', { patientId: patient.id }).then((payments) => {
            expect(payments.map((p) => [p.amount_cents, p.method, p.purpose])).to.deep.eq([[4500, 'card', 'visit']])
          })
          cy.task<{ status: string }[]>('db:invoicesFor', { patientId: patient.id }).then((invoices) => {
            expect(invoices.map((i) => i.status)).to.deep.eq(['paid'])
          })
          cy.task<unknown[]>('db:facturasFor', { patientId: patient.id }).its('length').should('eq', 1)
        })
      })
    })
  })
})
