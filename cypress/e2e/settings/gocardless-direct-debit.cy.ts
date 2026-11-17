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
    customers: [{ id: 'CU1', email: s.email, given_name: 'Ana', family_name: 'Domiciliada', company_name: null, phone_number: null, metadata: { practicehub_ref: 'PH-77' } }],
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
      // The organisation by its name, not only its OR… id.
      cy.get('[data-cy=gocardless-organisation-name]').should('have.text', 'Clínica Demo')
      cy.get('[data-cy=gocardless-organisation-id]').should('have.text', s.organisationId)

      // GoCardless's sign-in screen, in Spanish, with what its sign-up form
      // would otherwise ask again already filled in.
      cy.task<{ authorizeQueries: Record<string, string>[] }>('gc:state')
        .its('authorizeQueries')
        .should((queries) => {
          expect(queries).to.have.length(1)
          expect(queries[0]).to.include({ initial_view: 'login', language: 'es', 'prefill[country_code]': 'ES', 'prefill[email]': s.account.email })
          expect(queries[0]!['prefill[organisation_name]']).to.be.a('string').and.not.be.empty
        })

      cy.task<{ gocardless_organisation_id: string | null }[]>('db:selectRows', { table: 'accounts', columns: 'gocardless_organisation_id', match: { id: s.account.accountId } })
        .its('0.gocardless_organisation_id')
        .should('eq', s.organisationId)
      cy.task<{ is_active: boolean }[]>('db:selectRows', { table: 'payment_methods', columns: 'is_active', match: { account_id: s.account.accountId, key: 'direct_debit' } })
        .its('0.is_active')
        .should('eq', true)

      // Disconnecting revokes the token at GoCardless and forgets the
      // organisation, and touches no mandate.
      cy.get('[data-cy=gocardless-disconnect]').scrollIntoView().click({ force: true })
      cy.get('[data-cy=confirm-dialog]').should('contain.text', 'Disconnect GoCardless?')
      cy.get('[data-cy=confirm-dialog-confirm]').click()
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
      cy.task<{ patient_id: string; bank_name: string; account_number_ending: string; reference: string }[]>('db:selectRows', {
        table: 'patient_gocardless_mandates',
        columns: 'patient_id, bank_name, account_number_ending, reference',
        match: { account_id: s.account.accountId, gocardless_mandate_id: 'MD1' },
      }).should((rows) => {
        expect(rows).to.have.length(1)
        expect(rows[0]).to.deep.equal({ patient_id: s.patientId, bank_name: 'BANCO STUB', account_number_ending: '34', reference: 'PH-REF' })
      })
      // Our patient id onto the GoCardless customer, beside the key the
      // other app keeps there, which survives the update.
      cy.task<{ customerUpdates: { id: string; metadata: Record<string, string> }[] }>('gc:state')
        .its('customerUpdates')
        .should('deep.equal', [{ id: 'CU1', metadata: { practicehub_ref: 'PH-77', quiroflow_patient_id: s.patientId } }])

      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.get('[data-cy=patient-direct-debit]', SLOW).should('contain.text', '••34')
      // The reference the patient sees on their bank statement.
      cy.get('[data-cy=patient-direct-debit-reference]').should('contain.text', 'PH-REF')
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
      // When GoCardless will next collect it, read from the subscription.
      cy.get('[data-cy=membership-next-charge]', SLOW).should('contain.text', 'next charge').and('contain.text', '2 Dec 2026')

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

      // Each event is handled once: delivered again, EV1 is not even read
      // from GoCardless a second time.
      cy.task<{ gocardless_event_id: string }[]>('db:selectRows', { table: 'gocardless_processed_events', columns: 'gocardless_event_id', match: { account_id: s.account.accountId } })
        .then((rows) => expect(rows.map((r) => r.gocardless_event_id).sort()).to.deep.equal(['EV1', 'EV2']))
      cy.task<{ requests: string[] }>('gc:state').then(({ requests }) => {
        const before = requests.filter((r) => r === 'GET /payments/PM1').length
        deliver([confirmed('EV1')]).its('status').should('eq', 200)
        cy.task<{ requests: string[] }>('gc:state').its('requests').should((after) => {
          expect(after.filter((r) => r === 'GET /payments/PM1')).to.have.length(before)
        })
      })

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

      // The ledger names the collection the way GoCardless does (PM…).
      cy.login(s.account.email, s.account.password)
      cy.visit(`/patients/${s.patientId}?tab=money`)
      cy.contains('td', 'PM1', SLOW).click()
      cy.contains('dt', 'GoCardless payment').next('dd').should('have.text', 'PM1')
      cy.contains('dd', 'Automatic (direct debit)').should('exist')
    })
  })

  it('suggests a similar name, opens the search empty when the name finds nobody, and tags and untags the customer', () => {
    seed({ connected: true }).then((s) => {
      cy.task('gc:start', {
        organisationId: s.organisationId,
        customers: [
          // No email or phone: only the name, written with an initial.
          { id: 'CU-J', email: null, given_name: 'A.', family_name: 'Domiciliada', company_name: null, phone_number: null, metadata: { practicehub_ref: 'PH-1' } },
          { id: 'CU-X', email: null, given_name: 'Zoe', family_name: 'Inexistente', company_name: null, phone_number: null },
          // Paired with this patient before: our id is on the customer.
          { id: 'CU-M', email: null, given_name: 'Otro', family_name: 'Nombre', company_name: null, phone_number: null, metadata: { quiroflow_patient_id: s.patientId } },
        ],
        bankAccounts: [{ id: 'BA1', bank_name: 'BANCO STUB', account_number_ending: '34' }],
        mandates: ['J', 'X', 'M'].map((k) => ({ id: `MD-${k}`, status: 'active', scheme: 'sepa_core', reference: `REF-${k}`, created_at: '2026-01-10T10:00:00Z', next_possible_charge_date: '2026-11-20', links: { customer: `CU-${k}`, customer_bank_account: 'BA1', creditor: 'CR-STUB' } })),
        subscriptions: [],
      })
      cy.login(s.account.email, s.account.password)

      // The payment_setup_url GoCardless sends clinics to.
      cy.visit('/settings/import?source=gocardless')
      cy.location('search', SLOW).should('contain', 'type=gocardless')
      cy.get('[data-cy=gocardless-mandate][data-mandate=MD-M]', SLOW).should('contain.text', 'paired before')
      cy.get('[data-cy=gocardless-mandate][data-mandate=MD-X]').within(() => {
        cy.contains('No patient found')
        cy.get('[data-cy=gocardless-choose]').click()
        cy.get('[data-cy=gocardless-patient-search]').should('have.value', '').and('have.attr', 'placeholder').and('contain', 'Zoe Inexistente')
        cy.get('[data-cy=gocardless-patient-search]').type('Domiciliada')
        cy.get('[data-cy=gocardless-patient-option]', SLOW).should('contain.text', 'Ana Domiciliada')
      })
      cy.get('[data-cy=gocardless-mandate][data-mandate=MD-J]').within(() => {
        cy.contains('Ana Domiciliada')
        cy.contains('similar name')
        cy.get('[data-cy=gocardless-confirm]').click()
        cy.get('[data-cy=gocardless-paired]', SLOW).should('exist')
      })
      cy.task<{ customerUpdates: { id: string; metadata: Record<string, string> }[] }>('gc:state')
        .its('customerUpdates')
        .should('deep.equal', [{ id: 'CU-J', metadata: { practicehub_ref: 'PH-1', quiroflow_patient_id: s.patientId } }])

      // Unpaired: our key comes off, the other app's stays.
      cy.get('[data-cy=gocardless-mandate][data-mandate=MD-J]').find('[data-cy=gocardless-unmatch]').click()
      cy.task<{ customerUpdates: { id: string; metadata: Record<string, string> }[] }>('gc:state')
        .its('customerUpdates')
        .should('have.length', 2)
        .its(1)
        .should('deep.equal', { id: 'CU-J', metadata: { practicehub_ref: 'PH-1' } })
    })
  })

  it('sends the clinic to GoCardless to verify, and shows the card when the status cannot be read', () => {
    seed({ connected: true }).then((s) => {
      cy.task('gc:start', { organisationId: s.organisationId, verificationStatus: 'action_required' })
      cy.login(s.account.email, s.account.password)
      cy.visit('/settings/payments')
      cy.get('[data-cy=gocardless-status]', SLOW).should('contain.text', 'Verification needed')
      cy.get('[data-cy=gocardless-verify]').should('have.attr', 'href', 'https://verify-sandbox.gocardless.com')

      // Back from GoCardless (its post_onboarding_url): read again, verified.
      cy.task('gc:update', { verificationStatus: 'successful' })
      cy.visit('/settings/payments?gocardless=verified')
      cy.get('[data-cy=gocardless-status]', SLOW).should('contain.text', 'Connected')
      cy.get('[data-cy=gocardless-verify]').should('not.exist')
      cy.location('search').should('not.contain', 'gocardless=')
      cy.task<{ gocardless_verification_status: string }[]>('db:selectRows', { table: 'accounts', columns: 'gocardless_verification_status', match: { id: s.account.accountId } })
        .its('0.gocardless_verification_status')
        .should('eq', 'successful')

      // A status that cannot be read is an error on the card, not no card.
      cy.intercept('GET', '/api/gocardless/status*', { statusCode: 500, body: { statusMessage: 'down' } })
      cy.reload()
      cy.get('[data-cy=gocardless-section]', SLOW).should('exist')
      cy.get('[data-cy=gocardless-load-error]').should('contain.text', 'Could not check the GoCardless connection')
    })
  })
})
