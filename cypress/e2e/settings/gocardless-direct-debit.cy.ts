import type { StaffAccount } from '../../support/commands'

// Memberships collected by SEPA direct debit through the clinic's own
// GoCardless (server/api/gocardless/*), against the stub in
// cypress/support/tasks/gocardless.ts.
//
// The promise to a clinic leaving PracticeHub is that its patients sign
// nothing again: the mandates already in its GoCardless are paired with
// patients here and collected on. What these prove is that promise and its
// two dangers -- collecting beside PracticeHub's own subscription (the patient
// pays twice), and booking the same collection twice.

const WEBHOOK_SECRET = Cypress.env('GOCARDLESS_WEBHOOK_SECRET') ?? 'e2e-gocardless-webhook-secret'
// The first request to each of these routes can be slow on a cold server;
// what is being waited for is the app, not GoCardless.
const SLOW = { timeout: 30_000 }

interface Seeded {
  account: StaffAccount
  organisationId: string
  patientId: string
  email: string
  membershipId: string
}

function seed(opts: { connected?: boolean } = {}): Cypress.Chainable<Seeded> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const organisationId = `OR${stamp}`
  const email = `ana.domiciliada.${stamp}@example.test`
  return cy.seedStaffAccount().then((account) =>
    cy.task<{ id: string }>('db:createPatient', { accountId: account.accountId, clinicId: account.clinicId, firstName: 'Ana', lastName: 'Domiciliada', email }).then((patient) =>
      cy
        .task<{ id: string }[]>('db:insertRows', {
          table: 'patient_memberships',
          rows: [{ account_id: account.accountId, patient_id: patient.id, membership_name: 'Mensual', price_cents: 4500, status: 'active', billing_interval: 'month', billing_interval_count: 1 }],
          select: 'id',
        })
        .then((rows) => {
          if (opts.connected) {
            cy.task('db:updateRows', { table: 'accounts', values: { gocardless_organisation_id: organisationId, gocardless_environment: 'sandbox', gocardless_verification_status: 'successful' }, match: { id: account.accountId } })
            cy.task('db:setAccountSecret', { accountId: account.accountId, name: 'gocardless_access_token', value: 'STUB-GC-TOKEN' })
            cy.task('db:updateRows', { table: 'payment_methods', values: { is_active: true }, match: { account_id: account.accountId, key: 'direct_debit' } })
          }
          return cy.wrap({ account, organisationId, patientId: patient.id, email, membershipId: rows[0]!.id })
        }),
    ),
  )
}

/** What a clinic coming from PracticeHub has in GoCardless: the patient, her bank, her mandate, and PracticeHub's subscription on it. */
function practiceHubHoldings(s: Seeded, opts: { practiceHubStillCollecting?: boolean; hideSubscriptions?: boolean } = {}) {
  return {
    organisationId: s.organisationId,
    customers: [{ id: 'CU1', email: s.email, given_name: 'Ana', family_name: 'Domiciliada', company_name: null, phone_number: null }],
    bankAccounts: [{ id: 'BA1', bank_name: 'BANCO STUB', account_number_ending: '34' }],
    mandates: [{ id: 'MD1', status: 'active', scheme: 'sepa_core', reference: 'PH-REF', created_at: '2026-01-10T10:00:00Z', next_possible_charge_date: '2026-11-20', links: { customer: 'CU1', customer_bank_account: 'BA1', creditor: 'CR-STUB' } }],
    subscriptions: [
      {
        id: 'SB-PH',
        status: opts.practiceHubStillCollecting === false ? 'cancelled' : 'active',
        amount: 4500,
        currency: 'EUR',
        name: 'Membresía PracticeHub',
        interval_unit: 'monthly',
        interval: 1,
        upcoming_payments: [{ charge_date: '2026-12-01', amount: 4500 }],
        links: { mandate: 'MD1' },
      },
    ],
    hideSubscriptions: opts.hideSubscriptions ?? false,
  }
}

function deliver(events: Record<string, unknown>[], secret = WEBHOOK_SECRET) {
  const body = JSON.stringify({ events })
  return cy.task<string>('gc:sign', { body, secret }).then((signature) =>
    cy.request({ method: 'POST', url: '/api/gocardless/webhook', body, headers: { 'content-type': 'application/json', 'webhook-signature': signature }, failOnStatusCode: false }),
  )
}

describe('GoCardless direct debit', () => {
  afterEach(() => {
    cy.task('gc:stop')
  })

  it('connects the clinic’s own GoCardless and switches the direct debit method on', () => {
    seed().then((s) => {
      cy.task('gc:start', practiceHubHoldings(s))
      cy.login(s.account.email, s.account.password)
      // The whole round trip: our start, GoCardless's authorise screen (the
      // stub says yes at once), our callback.
      cy.visit('/api/gocardless/connect/start')
      cy.location('pathname').should('eq', '/settings/payments')
      cy.get('[data-cy=gocardless-connected]', SLOW).should('exist')
      cy.get('[data-cy=gocardless-status]', SLOW).should('contain.text', 'Connected')

      cy.task<{ gocardless_organisation_id: string | null }[]>('db:selectRows', { table: 'accounts', columns: 'gocardless_organisation_id', match: { id: s.account.accountId } })
        .its('0.gocardless_organisation_id')
        .should('eq', s.organisationId)
      cy.task<{ is_active: boolean }[]>('db:selectRows', { table: 'payment_methods', columns: 'is_active', match: { account_id: s.account.accountId, key: 'direct_debit' } })
        .its('0.is_active')
        .should('eq', true)

      // Disconnecting revokes the token at GoCardless and forgets the
      // organisation, and touches no mandate.
      cy.get('[data-cy=gocardless-disconnect]').scrollIntoView().click({ force: true })
      cy.contains('button', 'Disconnect').last().click()
      cy.get('[data-cy=gocardless-status]', SLOW).should('contain.text', 'Not connected')
      cy.task<{ revoked: string[] }>('gc:state').its('revoked').should('deep.equal', ['STUB-GC-TOKEN'])
      cy.task<{ gocardless_organisation_id: string | null }[]>('db:selectRows', { table: 'accounts', columns: 'gocardless_organisation_id', match: { id: s.account.accountId } })
        .its('0.gocardless_organisation_id')
        .should('be.null')
    })
  })

  it('pairs a PracticeHub mandate, will not collect beside PracticeHub, then collects on the same mandate', () => {
    seed({ connected: true }).then((s) => {
      cy.task('gc:start', practiceHubHoldings(s))
      cy.login(s.account.email, s.account.password)

      cy.visit('/settings/import?source=practicehub&type=gocardless')
      cy.get('[data-cy=gocardless-mandate][data-mandate=MD1]', SLOW).within(() => {
        cy.contains('Ana Domiciliada')
        cy.contains('same email')
        // PracticeHub's subscription is shown for what it is.
        cy.get('[data-cy=gocardless-subscription]').should('contain.text', 'Another app')
        cy.get('[data-cy=gocardless-confirm]').click()
        cy.get('[data-cy=gocardless-paired]', SLOW).should('exist')
      })
      cy.task<{ patient_id: string; bank_name: string; account_number_ending: string }[]>('db:selectRows', {
        table: 'patient_gocardless_mandates',
        columns: 'patient_id, bank_name, account_number_ending',
        match: { account_id: s.account.accountId, gocardless_mandate_id: 'MD1' },
      }).should((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.deep.equal({ patient_id: s.patientId, bank_name: 'BANCO STUB', account_number_ending: '34' })
      })

      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=patient-direct-debit]', SLOW).should('contain.text', '••34')
      cy.get('[data-cy=membership-autopay-open]', SLOW).click()
      cy.get('[data-cy=membership-autopay-form]').within(() => {
        cy.root().submit()
      })
      // PracticeHub is still collecting on the mandate: refused, by name.
      cy.get('[data-cy=membership-autopay-form]', SLOW).should('contain.text', 'Membresía PracticeHub')
      cy.task<{ created: unknown[] }>('gc:state').its('created').should('have.length', 0)

      // Its subscription cancelled -- the subscription, not the mandate.
      cy.task('gc:update', { subscriptions: practiceHubHoldings(s, { practiceHubStillCollecting: false }).subscriptions })
      cy.get('[data-cy=membership-autopay-start]').type('2026-12-02')
      cy.get('[data-cy=membership-autopay-form]').submit()
      cy.get('[data-cy=membership-autopay-form]', SLOW).should('not.exist')

      cy.task<{ created: { amount: number; currency: string; interval_unit: string; interval: number; start_date: string; links: { mandate: string } }[] }>('gc:state')
        .its('created')
        .should((created) => {
          expect(created).to.have.length(1)
          expect(created[0]).to.include({ amount: 4500, currency: 'EUR', interval_unit: 'monthly', interval: 1, start_date: '2026-12-02' })
          expect(created[0]!.links.mandate).to.eq('MD1')
        })
      cy.task<{ provider: string; gocardless_mandate_id: string; status: string }[]>('db:selectRows', {
        table: 'payment_schedules',
        columns: 'provider, gocardless_mandate_id, status',
        match: { patient_membership_id: s.membershipId },
      }).should('deep.equal', [{ provider: 'gocardless', gocardless_mandate_id: 'MD1', status: 'active' }])
    })
  })

  it('asks before collecting when GoCardless hides other apps’ subscriptions', () => {
    seed({ connected: true }).then((s) => {
      cy.task('gc:start', practiceHubHoldings(s, { hideSubscriptions: true }))
      cy.task('db:insertRows', {
        table: 'patient_gocardless_mandates',
        rows: [{ account_id: s.account.accountId, patient_id: s.patientId, gocardless_mandate_id: 'MD1', gocardless_customer_id: 'CU1', status: 'active', matched_by: 'email' }],
      })
      cy.login(s.account.email, s.account.password)
      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=membership-autopay-open]', SLOW).click()
      cy.get('[data-cy=membership-autopay-form]').submit()
      cy.get('[data-cy=membership-autopay-confirm-other]', SLOW).find('input').check()
      cy.task<{ created: unknown[] }>('gc:state').its('created').should('have.length', 0)
      cy.get('[data-cy=membership-autopay-form]').submit()
      cy.get('[data-cy=membership-autopay-form]', SLOW).should('not.exist')
      cy.task<{ created: unknown[] }>('gc:state').its('created').should('have.length', 1)
    })
  })

  it('books a collected period once, however often GoCardless says so, and flags a chargeback', () => {
    seed({ connected: true }).then((s) => {
      // gocardless_subscription_id is unique across every clinic in the database.
      const subscriptionId = `SB-QF-${s.organisationId}`
      cy.task('db:insertRows', {
        table: 'payment_schedules',
        rows: [{ account_id: s.account.accountId, patient_id: s.patientId, patient_membership_id: s.membershipId, provider: 'gocardless', gocardless_subscription_id: subscriptionId, gocardless_mandate_id: 'MD1', interval: 'month', interval_count: 1, status: 'active' }],
      })
      cy.task('gc:start', {
        ...practiceHubHoldings(s),
        payments: [{ id: 'PM1', status: 'confirmed', amount: 4500, currency: 'EUR', charge_date: '2026-12-02', links: { mandate: 'MD1', subscription: subscriptionId, creditor: 'CR-STUB' } }],
      })

      // A forged delivery is refused before anything is read.
      deliver([{ id: 'EV0', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM1', organisation: s.organisationId } }], 'not-the-secret').its('status').should('eq', 498)

      const confirmed = (id: string) => ({ id, created_at: '2026-12-04T09:00:00Z', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM1', organisation: s.organisationId } })
      deliver([confirmed('EV1')]).its('status').should('eq', 200)
      // The same delivery again, and a second event for the same payment.
      deliver([confirmed('EV1')]).its('status').should('eq', 200)
      deliver([confirmed('EV2')]).its('status').should('eq', 200)

      cy.task<{ amount_cents: number; method: string; purpose: string; invoice_id: string | null }[]>('db:selectRows', {
        table: 'payments',
        columns: 'amount_cents, method, purpose, invoice_id',
        match: { account_id: s.account.accountId, gocardless_payment_id: 'PM1' },
      }).should((rows) => {
        expect(rows, 'one payment, however many deliveries').to.have.length(1)
        expect(rows[0]).to.include({ amount_cents: 4500, method: 'direct_debit', purpose: 'membership' })
        expect(rows[0]!.invoice_id).to.be.a('string')
      })
      cy.task<{ installments_paid: number }[]>('db:selectRows', { table: 'payment_schedules', columns: 'installments_paid', match: { gocardless_subscription_id: subscriptionId } })
        .its('0.installments_paid')
        .should('eq', 1)

      // The patient reclaims it from their bank: reception is told, and the
      // schedule shows it is behind. The refund itself is theirs to record.
      deliver([{ id: 'EV3', created_at: '2026-12-10T09:00:00Z', resource_type: 'payments', action: 'charged_back', links: { payment: 'PM1', organisation: s.organisationId } }])
        .its('status')
        .should('eq', 200)
      cy.task<{ title: string }[]>('db:selectRows', { table: 'staff_tasks', columns: 'title', match: { account_id: s.account.accountId, patient_id: s.patientId } }).should((rows) => {
        // One per owner; a seeded clinic has one.
        expect(rows).to.have.length(1)
        expect(rows[0]!.title).to.contain('Domiciliación devuelta')
      })
      cy.task<{ status: string }[]>('db:selectRows', { table: 'payment_schedules', columns: 'status', match: { gocardless_subscription_id: subscriptionId } })
        .its('0.status')
        .should('eq', 'past_due')
    })
  })
})
