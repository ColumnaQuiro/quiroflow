import type { StaffAccount } from '../../support/commands'

// New direct-debit mandates from a link (Billing Request + Billing Request
// Flow), refunds sent back through GoCardless, and Success+ retries -- the
// pieces GoCardless's partner review asked for on top of phase 1
// (gocardless-direct-debit.cy.ts). Against the stub in
// cypress/support/tasks/gocardless.ts.
//
// What these prove: the mandate a patient signs from the link lands on THAT
// patient with nobody pairing it, and a membership collects on it; a refund
// reaches GoCardless before the books say it happened, and a refused one
// leaves the books alone; a payment Success+ retries stops reading as failed.

const WEBHOOK_SECRET = Cypress.env('GOCARDLESS_WEBHOOK_SECRET') ?? 'e2e-gocardless-webhook-secret'
const SLOW = { timeout: 30_000 }

interface Seeded {
  account: StaffAccount
  organisationId: string
  patientId: string
  email: string
  membershipId: string
}

function seed(): Cypress.Chainable<Seeded> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const organisationId = `OR${stamp}`
  const email = `nora.enlace.${stamp}@example.test`
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Nora', lastName: 'Enlace', email }).then((patient) => {
      cy.task('db:updateRows', { table: 'patients', values: { address: 'Calle Mayor 1', city: 'Madrid', postal_code: '28013', country: 'España' }, match: { id: patient.id } })
      cy.task('db:updateRows', { table: 'accounts', values: { gocardless_organisation_id: organisationId, gocardless_environment: 'sandbox', gocardless_verification_status: 'successful' }, match: { id: account.accountId } })
      cy.task('db:setAccountSecret', { accountId: account.accountId, name: 'gocardless_access_token', value: 'STUB-GC-TOKEN' })
      cy.task('db:updateRows', { table: 'payment_methods', values: { is_active: true }, match: { account_id: account.accountId, key: 'direct_debit' } })
      return cy
        .task<{ id: string }[]>('db:insertRows', {
          table: 'patient_memberships',
          rows: [{ account_id: account.accountId, patient_id: patient.id, membership_name: 'Mensual', price_cents: 4500, status: 'active', billing_interval: 'month', billing_interval_count: 1 }],
          select: 'id',
        })
        .then((rows) => cy.wrap({ account, organisationId, patientId: patient.id, email, membershipId: rows[0]!.id }))
    }),
  )
}

/** What GoCardless holds once the patient has signed: their new customer, bank account and mandate. */
function signedHoldings(s: Seeded) {
  return {
    organisationId: s.organisationId,
    customers: [{ id: 'CU-NEW', email: s.email, given_name: 'Nora', family_name: 'Enlace', company_name: null, phone_number: null }],
    bankAccounts: [{ id: 'BA-NEW', bank_name: 'BANCO STUB', account_number_ending: '78' }],
    mandates: [{ id: 'MD-NEW', status: 'pending_submission', scheme: 'sepa_core', reference: 'QF-REF', created_at: '2026-11-17T10:00:00Z', next_possible_charge_date: '2026-11-21', links: { customer: 'CU-NEW', customer_bank_account: 'BA-NEW', creditor: 'CR-STUB' } }],
  }
}

function deliver(events: Record<string, unknown>[]) {
  const body = JSON.stringify({ events })
  return cy.task<string>('gc:sign', { body, secret: WEBHOOK_SECRET }).then((signature) =>
    cy.request({ method: 'POST', url: '/api/gocardless/webhook', body, headers: { 'content-type': 'application/json', 'webhook-signature': signature }, failOnStatusCode: false }),
  )
}

interface StubState {
  created: Record<string, any>[]
  billingRequests: Record<string, any>[]
  billingRequestBodies: Record<string, any>[]
  flowBodies: Record<string, any>[]
  refundBodies: Record<string, any>[]
}

describe('GoCardless: new mandates, refunds and retries', () => {
  afterEach(() => {
    cy.task('gc:stop')
  })

  it('sends a sign-up link, pairs the signed mandate with that patient, and collects a membership on it', () => {
    seed().then((s) => {
      cy.task('gc:start', signedHoldings(s))
      cy.login(s.account.email, s.account.password)
      cy.visit(`/patients/${s.patientId}?tab=money`)

      cy.get('[data-cy=direct-debit-link]', SLOW).should('contain.text', 'No direct debit')
      cy.get('[data-cy=direct-debit-link-open]').click()
      cy.get('[data-cy=direct-debit-link-url]', SLOW).invoke('val').should('match', /\/flow\/BRF-/)
      cy.get('[data-cy=direct-debit-link-status]').should('contain.text', 'not signed yet')

      // What GoCardless was asked for: a SEPA Core mandate, its page opened
      // with what the clinic already knows, coming back to QuiroFlow.
      cy.task<StubState>('gc:state').should((st) => {
        expect(st.billingRequestBodies).to.have.length(1)
        expect(st.billingRequestBodies[0]!.mandate_request).to.deep.equal({ scheme: 'sepa_core', currency: 'EUR' })
        expect(st.billingRequestBodies[0]!.metadata).to.deep.equal({ quiroflow_patient: s.patientId })
        expect(st.flowBodies[0]!.prefilled_customer).to.deep.equal({
          given_name: 'Nora',
          family_name: 'Enlace',
          email: s.email,
          address_line1: 'Calle Mayor 1',
          city: 'Madrid',
          postal_code: '28013',
          country_code: 'ES',
        })
        expect(st.flowBodies[0]!.redirect_uri).to.match(/\/direct-debit-done$/)
        expect(st.flowBodies[0]!.links.billing_request).to.eq(st.billingRequests[0]!.id)
      })

      // Asking again hands back the same open link, not a second mandate.
      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=direct-debit-link-open]', SLOW).should('contain.text', 'Show sign-up link').click()
      cy.get('[data-cy=direct-debit-link-url]', SLOW).invoke('val').should('match', /\/flow\/BRF-/)
      cy.task<StubState>('gc:state').its('billingRequestBodies').should('have.length', 1)

      // The patient signs; GoCardless says so.
      cy.task<string>('gc:fulfil', { mandateId: 'MD-NEW', customerId: 'CU-NEW' }).then((billingRequestId) => {
        deliver([{ id: `EV-BR-${s.organisationId}`, created_at: '2026-11-17T10:05:00Z', resource_type: 'billing_requests', action: 'fulfilled', links: { billing_request: billingRequestId, organisation: s.organisationId } }])
          .its('status')
          .should('eq', 200)
      })
      cy.task<Record<string, unknown>[]>('db:selectRows', {
        table: 'patient_gocardless_mandates',
        columns: 'patient_id, origin, matched_by, account_number_ending',
        match: { account_id: s.account.accountId, gocardless_mandate_id: 'MD-NEW' },
      }).should('deep.equal', [{ patient_id: s.patientId, origin: 'created_here', matched_by: 'link', account_number_ending: '78' }])
      cy.task<{ status: string }[]>('db:selectRows', { table: 'gocardless_billing_requests', columns: 'status', match: { patient_id: s.patientId } })
        .its('0.status')
        .should('eq', 'fulfilled')

      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=patient-direct-debit]', SLOW).should('contain.text', '••78')
      cy.get('[data-cy=direct-debit-link]').should('not.exist')

      // And the membership collects on it, with Success+ retries asked for.
      cy.get('[data-cy=membership-autopay-open]', SLOW).click()
      cy.get('[data-cy=membership-autopay-form]').submit()
      cy.get('[data-cy=membership-autopay-form]', SLOW).should('not.exist')
      cy.task<StubState>('gc:state')
        .its('created')
        .should((created) => {
          expect(created).to.have.length(1)
          expect(created[0]).to.include({ amount: 4500, retry_if_possible: true })
          expect(created[0]!.links.mandate).to.eq('MD-NEW')
        })
    })
  })

  it('pairs a signed link when the Money tab opens, before any webhook', () => {
    seed().then((s) => {
      cy.task('gc:start', signedHoldings(s))
      cy.login(s.account.email, s.account.password)
      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=direct-debit-link-open]', SLOW).click()
      cy.get('[data-cy=direct-debit-link-url]', SLOW).should('exist')
      cy.task('gc:fulfil', { mandateId: 'MD-NEW', customerId: 'CU-NEW' })

      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=patient-direct-debit]', SLOW).should('contain.text', '••78')
      cy.get('[data-cy=direct-debit-link]').should('not.exist')
    })
  })

  it('refunds a collected payment through GoCardless, and records nothing when GoCardless refuses', () => {
    seed().then((s) => {
      const subscriptionId = `SB-QF-${s.organisationId}`
      cy.task('db:insertRows', {
        table: 'patient_gocardless_mandates',
        rows: [{ account_id: s.account.accountId, patient_id: s.patientId, gocardless_mandate_id: 'MD-NEW', gocardless_customer_id: 'CU-NEW', status: 'active', matched_by: 'link', origin: 'created_here' }],
      })
      cy.task('db:insertRows', {
        table: 'payment_schedules',
        rows: [{ account_id: s.account.accountId, patient_id: s.patientId, patient_membership_id: s.membershipId, provider: 'gocardless', gocardless_subscription_id: subscriptionId, gocardless_mandate_id: 'MD-NEW', interval: 'month', interval_count: 1, status: 'active' }],
      })
      cy.task('gc:start', {
        ...signedHoldings(s),
        payments: [{ id: 'PM-R', status: 'confirmed', amount: 4500, amount_refunded: 0, currency: 'EUR', charge_date: '2026-12-02', links: { mandate: 'MD-NEW', subscription: subscriptionId, creditor: 'CR-STUB' } }],
      })
      deliver([{ id: `EV-PM-${s.organisationId}`, created_at: '2026-12-04T09:00:00Z', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM-R', organisation: s.organisationId } }])
        .its('status')
        .should('eq', 200)

      const refund = (euros: string) => {
        cy.visit(`/patients/${s.patientId}?tab=money`)
        // The collected payment's row (not "Refund payment"), and its own
        // Refund action, which names an amount (the receipt's does not).
        cy.contains('tr', /Payment — Direct debit/, SLOW).click()
        cy.contains('button', /^Refund…\s+\d/).click()
        cy.get('[data-cy=refund-through-gocardless]').should('be.visible')
        cy.get('[role=dialog] input[type=number]').clear().type(euros)
        cy.get('[role=dialog]').contains('button', /^Refund$/).click()
      }

      refund('20')
      cy.task<StubState>('gc:state')
        .its('refundBodies', SLOW)
        .should((bodies) => {
          expect(bodies).to.have.length(1)
          expect(bodies[0]).to.deep.include({ amount: 2000, total_amount_confirmation: 2000 })
          expect(bodies[0]!.links).to.deep.equal({ payment: 'PM-R' })
        })
      cy.task<{ amount_cents: number; gocardless_refund_id: string | null }[]>('db:selectRows', {
        table: 'payments',
        columns: 'amount_cents, gocardless_refund_id',
        match: { account_id: s.account.accountId, patient_id: s.patientId, method: 'direct_debit' },
      }).should((rows) => {
        const back = rows.filter((r) => r.amount_cents < 0)
        expect(back).to.have.length(1)
        expect(back[0]!.amount_cents).to.eq(-2000)
        expect(back[0]!.gocardless_refund_id).to.match(/^RF-/)
      })

      // GoCardless will not refund the rest: the books are left alone.
      cy.task('gc:update', { refundsForbidden: true })
      refund('25')
      cy.contains('Refunds are not enabled', SLOW).should('be.visible')
      cy.task<{ amount_cents: number }[]>('db:selectRows', {
        table: 'payments',
        columns: 'amount_cents',
        match: { account_id: s.account.accountId, patient_id: s.patientId },
      }).should((rows) => {
        expect(rows.filter((r) => r.amount_cents < 0), 'only the first refund').to.have.length(1)
      })
      cy.task<{ is_refund: boolean }[]>('db:selectRows', { table: 'invoices', columns: 'is_refund', match: { account_id: s.account.accountId, patient_id: s.patientId, is_refund: true } }).should('have.length', 1)
    })
  })

  it('stops calling a payment failed once Success+ retries it', () => {
    seed().then((s) => {
      const subscriptionId = `SB-QF-${s.organisationId}`
      cy.task('db:insertRows', {
        table: 'payment_schedules',
        rows: [{ account_id: s.account.accountId, patient_id: s.patientId, patient_membership_id: s.membershipId, provider: 'gocardless', gocardless_subscription_id: subscriptionId, gocardless_mandate_id: 'MD-NEW', interval: 'month', interval_count: 1, status: 'active' }],
      })
      cy.task('gc:start', {
        ...signedHoldings(s),
        payments: [{ id: 'PM-F', status: 'failed', amount: 4500, currency: 'EUR', charge_date: '2026-12-02', links: { mandate: 'MD-NEW', subscription: subscriptionId, creditor: 'CR-STUB' } }],
      })
      const event = (id: string, action: string, details: Record<string, unknown> = {}) => ({
        id: `${id}-${s.organisationId}`,
        created_at: '2026-12-04T09:00:00Z',
        resource_type: 'payments',
        action,
        details,
        links: { payment: 'PM-F', organisation: s.organisationId },
      })
      deliver([event('EV-F', 'failed', { will_attempt_retry: false, cause: 'insufficient_funds' })]).its('status').should('eq', 200)
      cy.task<{ status: string }[]>('db:selectRows', { table: 'payment_schedules', columns: 'status', match: { gocardless_subscription_id: subscriptionId } })
        .its('0.status')
        .should('eq', 'past_due')
      cy.task<unknown[]>('db:selectRows', { table: 'membership_payments', columns: 'status', match: { patient_membership_id: s.membershipId, status: 'failed' } }).should('have.length', 1)

      deliver([event('EV-R', 'resubmission_requested')]).its('status').should('eq', 200)
      cy.task<{ status: string }[]>('db:selectRows', { table: 'payment_schedules', columns: 'status', match: { gocardless_subscription_id: subscriptionId } })
        .its('0.status')
        .should('eq', 'active')
      cy.task<unknown[]>('db:selectRows', { table: 'membership_payments', columns: 'status', match: { patient_membership_id: s.membershipId, status: 'failed' } }).should('have.length', 0)
    })
  })
})
