// Ids that say WHICH clinic something belongs to are not settings, and an id
// that arrives inside a webhook body is not proof of anything.
//
// Every clinic is one self-service signup away, so "an owner" is anyone. These
// are made the way an attacker would make them: with the browser's own key and
// a real signed-in owner session, or a webhook signed with a secret the clinic
// typed in itself.

describe('One clinic cannot claim another clinic’s connections or records', () => {
  it('refuses an owner who types a Messenger Page or a Stripe account into their own row', () => {
    cy.seedStaffAccount().then((account) => {
      const write = (values: Record<string, unknown>) =>
        cy.task<{ changed: number; error: string | null }>('db:settingsWriteAsStaff', {
          email: account.email,
          password: account.password,
          table: 'accounts',
          op: 'update',
          values,
          match: { id: account.accountId },
        })

      // Page ids are public. Typed in, it routed another clinic's Messenger
      // DMs into this one's Inbox.
      write({ messenger_page_id: `1${Date.now()}` }).then((result) => {
        expect(result.changed, 'rows changed').to.eq(0)
        expect(result.error).to.match(/messenger_page_id is set by connecting Instagram/)
      })
      // acct_ ids are handed out by every public deposit. Typed in, the
      // Connect webhook dropped the real owner's events, and Disconnect
      // revoked their Stripe connection.
      write({ stripe_connect_account_id: `acct_cypress${Date.now()}` }).then((result) => {
        expect(result.changed, 'rows changed').to.eq(0)
        expect(result.error).to.match(/stripe_connect_account_id is set by connecting Stripe/)
      })
      // Giving a Page up is still the clinic's to do (clearing the Instagram ID).
      write({ messenger_page_id: null }).then((result) => {
        expect(result.error).to.eq(null)
      })
      // The control: the same owner, the same row, an ordinary setting. Without
      // it the two refusals above would pass for a broken session too.
      write({ google_review_url: 'https://g.page/r/cypress/review' }).then((result) => {
        expect(result.error).to.eq(null)
        expect(result.changed, 'rows changed').to.eq(1)
      })
    })
  })

  it('does not let a webhook signed for one clinic mark another clinic’s invoice paid', () => {
    // The victim: a patient of clinic B with an unpaid invoice.
    cy.seedStaffAccount().then((victim) => {
      cy.task<{ id: string }>('db:createPatient', { accountId: victim.accountId, clinicId: victim.clinicId, firstName: 'Lucía', lastName: 'Prieto' }).then((patient) => {
        cy.task<{ id: string }>('db:createInvoice', { accountId: victim.accountId, patientId: patient.id, totalCents: 6000, status: 'unpaid' }).then((invoice) => {
          // The attacker: clinic A, whose legacy Stripe webhook secret is
          // whatever A saved -- so A can sign any event it likes.
          cy.seedStaffAccount().then((attacker) => {
            cy.task<{ id: string }>('db:createPatient', { accountId: attacker.accountId, clinicId: attacker.clinicId, firstName: 'Mario', lastName: 'Sanz' }).then((attackerPatient) => {
              const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
              const webhookSecret = `whsec_cypress_${stamp}`
              cy.task('auto:membershipOnStripe', { accountId: attacker.accountId, patientId: attackerPatient.id, subscriptionId: `sub_cypress_${stamp}`, webhookSecret })
              const body = JSON.stringify({
                id: `evt_${stamp}`,
                object: 'event',
                type: 'payment_intent.succeeded',
                data: { object: { id: `pi_cypress_${stamp}`, object: 'payment_intent', amount_received: 6000, metadata: { invoice_id: invoice.id, source: 'patient_pay' } } },
              })
              cy.task<{ header: string }>('auto:signStripe', { body, secret: webhookSecret }).then(({ header }) =>
                cy
                  .request({ method: 'POST', url: `/api/stripe/webhook/${attacker.accountId}`, body, headers: { 'content-type': 'application/json', 'stripe-signature': header } })
                  .its('status')
                  .should('eq', 200),
              )

              cy.task<{ status: string }[]>('db:invoicesFor', { patientId: patient.id }).then((invoices) => {
                expect(invoices.map((i) => i.status), 'the victim clinic’s invoice').to.deep.eq(['unpaid'])
              })
              cy.task<unknown[]>('db:paymentsFor', { patientId: patient.id }).its('length').should('eq', 0)
              cy.task<unknown[]>('db:facturasFor', { patientId: patient.id }).its('length').should('eq', 0)
            })
          })
        })
      })
    })
  })
})
