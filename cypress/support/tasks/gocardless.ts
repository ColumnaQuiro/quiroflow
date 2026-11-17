// A stand-in for GoCardless (OAuth host and API) for the direct-debit specs.
//
// The connect callback spends a code and writes a token onto an account, and
// every other route reads and writes the clinic's GoCardless. Testing that
// against GoCardless's sandbox would need a real partner app's secret in CI;
// not testing it would leave the code that books money unexercised. So the
// server is pointed here (NUXT_GOCARDLESS_API_BASE_URL and
// NUXT_GOCARDLESS_CONNECT_BASE_URL in e2e.yml) and the spec sets up what
// GoCardless "holds" for each test.
//
// The port is fixed for the same reason as the Meta stub's: Nuxt reads the
// base URLs once at startup, before any spec runs.
import { createHmac } from 'node:crypto'
import { createServer, type Server } from 'node:http'

const GOCARDLESS_STUB_PORT = 9148

interface StubState {
  organisationId: string
  /** The creditor's name: what the Settings card shows beside the OR… id. */
  organisationName: string
  verificationStatus: string
  customers: Record<string, any>[]
  bankAccounts: Record<string, any>[]
  mandates: Record<string, any>[]
  subscriptions: Record<string, any>[]
  payments: Record<string, any>[]
  events: Record<string, any>[]
  /** Answer 403 to listing subscriptions, as GoCardless may for other apps' ones. */
  hideSubscriptions: boolean
  revoked: string[]
  created: Record<string, any>[]
  cancelled: string[]
  /** New-mandate sign-up: the Billing Requests created, as GoCardless holds them. */
  billingRequests: Record<string, any>[]
  /** The bodies QuiroFlow POSTed, to assert on what it asked for. */
  billingRequestBodies: Record<string, any>[]
  flowBodies: Record<string, any>[]
  refunds: Record<string, any>[]
  refundBodies: Record<string, any>[]
  /** Answer 403 to creating a refund, as GoCardless does until it enables refunds for a merchant. */
  refundsForbidden: boolean
  /** The query string of each OAuth authorise visit (prefill, initial_view, language). */
  authorizeQueries: Record<string, string>[]
  /** Each metadata a customer was updated with, as PUT. */
  customerUpdates: { id: string; metadata: Record<string, string> }[]
  /** Every authenticated API call, "GET /payments/PM1", to see what was asked again. */
  requests: string[]
}

let server: Server | null = null
let state: StubState = blank()

function blank(): StubState {
  return {
    organisationId: 'OR-STUB',
    organisationName: 'Clínica Demo',
    verificationStatus: 'successful',
    customers: [],
    bankAccounts: [],
    mandates: [],
    subscriptions: [],
    payments: [],
    events: [],
    hideSubscriptions: false,
    revoked: [],
    created: [],
    cancelled: [],
    billingRequests: [],
    billingRequestBodies: [],
    flowBodies: [],
    refunds: [],
    refundBodies: [],
    refundsForbidden: false,
    authorizeQueries: [],
    customerUpdates: [],
    requests: [],
  }
}

// Unique across runs, as GoCardless's own ids are: several tables hold every
// spec's ids side by side.
let seq = 0
const stubId = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`

async function startGoCardlessStub(opts: Partial<Omit<StubState, 'revoked' | 'created' | 'cancelled' | 'authorizeQueries' | 'customerUpdates' | 'requests'>> = {}) {
  await stopGoCardlessStub()
  state = { ...blank(), ...opts }

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${GOCARDLESS_STUB_PORT}`)
    const path = url.pathname
    const send = (status: number, body: unknown) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const list = (key: string, rows: Record<string, any>[]) => send(200, { [key]: rows, meta: { cursors: { after: null, before: null }, limit: 500 } })
    const one = (key: string, rows: Record<string, any>[], id: string) => {
      const row = rows.find((r) => r.id === id)
      return row ? send(200, { [key]: row }) : send(404, { error: { message: 'not found', type: 'invalid_api_usage', errors: [{ reason: 'resource_not_found' }] } })
    }
    const statusIn = (rows: Record<string, any>[]) => {
      const wanted = url.searchParams.get('status')?.split(',')
      return wanted ? rows.filter((r) => wanted.includes(r.status)) : rows
    }

    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      // OAuth: the authorise screen hands straight back to the callback, as a
      // clinic that clicked "Allow" would.
      if (path === '/oauth/authorize') {
        state.authorizeQueries.push(Object.fromEntries(url.searchParams))
        const back = new URL(url.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'STUB-CODE')
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        res.statusCode = 302
        res.setHeader('location', back.toString())
        return res.end()
      }
      if (path === '/oauth/access_token') return send(200, { access_token: 'STUB-GC-TOKEN', token_type: 'bearer', scope: 'read_write', organisation_id: state.organisationId })
      if (path === '/oauth/revoke') {
        state.revoked.push(new URLSearchParams(raw).get('token') ?? '')
        return send(200, {})
      }

      if (req.headers.authorization !== 'Bearer STUB-GC-TOKEN') {
        return send(401, { error: { message: 'Access token not found', type: 'invalid_api_usage', errors: [{ reason: 'access_token_not_found' }] } })
      }

      state.requests.push(`${req.method} ${path}`)

      if (path === '/creditors') return list('creditors', [{ id: 'CR-STUB', name: state.organisationName, verification_status: state.verificationStatus }])
      if (path === '/customers') return list('customers', state.customers)
      if (path.startsWith('/customers/') && req.method === 'PUT') {
        // GoCardless REPLACES metadata whole, and refuses more than three keys.
        const id = path.split('/')[2]!
        const customer = state.customers.find((c) => c.id === id)
        if (!customer) return send(404, { error: { message: 'not found', type: 'invalid_api_usage', errors: [{ reason: 'resource_not_found' }] } })
        const metadata = JSON.parse(raw || '{}').customers?.metadata ?? {}
        if (Object.keys(metadata).length > 3) return send(422, { error: { message: 'metadata has too many keys', type: 'validation_failed', errors: [{ reason: 'too_many_keys' }] } })
        customer.metadata = metadata
        state.customerUpdates.push({ id, metadata })
        return send(200, { customers: customer })
      }
      if (path.startsWith('/customers/')) return one('customers', state.customers, path.split('/')[2]!)
      if (path === '/customer_bank_accounts') return list('customer_bank_accounts', state.bankAccounts)
      if (path.startsWith('/customer_bank_accounts/')) return one('customer_bank_accounts', state.bankAccounts, path.split('/')[2]!)
      if (path === '/mandates') return list('mandates', statusIn(state.mandates))
      if (path.startsWith('/mandates/')) return one('mandates', state.mandates, path.split('/')[2]!)
      if (path.startsWith('/payments/')) return one('payments', state.payments, path.split('/')[2]!)
      if (path === '/events') return list('events', state.events)

      if (path === '/subscriptions' && req.method === 'GET') {
        if (state.hideSubscriptions) return send(403, { error: { message: 'Forbidden', type: 'invalid_api_usage', errors: [{ reason: 'forbidden' }] } })
        const mandate = url.searchParams.get('mandate')
        return list('subscriptions', statusIn(state.subscriptions).filter((s) => !mandate || s.links.mandate === mandate))
      }
      if (path === '/subscriptions' && req.method === 'POST') {
        const body = JSON.parse(raw || '{}').subscriptions ?? {}
        const subscription = {
          // Unique across runs, as GoCardless's own ids are: payment_schedules
          // holds every spec's subscriptions in one table.
          id: `SB-QF-${Date.now()}-${state.subscriptions.length + 1}`,
          status: 'active',
          upcoming_payments: [{ charge_date: body.start_date ?? '2026-12-01', amount: body.amount }],
          ...body,
        }
        state.subscriptions.push(subscription)
        state.created.push(subscription)
        return send(201, { subscriptions: subscription })
      }
      const cancel = path.match(/^\/subscriptions\/([^/]+)\/actions\/cancel$/)
      if (cancel) {
        const subscription = state.subscriptions.find((s) => s.id === cancel[1])
        if (!subscription) return send(404, { error: { message: 'not found' } })
        subscription.status = 'cancelled'
        state.cancelled.push(subscription.id)
        return send(200, { subscriptions: subscription })
      }
      if (path.startsWith('/subscriptions/')) return one('subscriptions', state.subscriptions, path.split('/')[2]!)

      // New mandates: a Billing Request, and the hosted flow the patient signs on.
      if (path === '/billing_requests' && req.method === 'POST') {
        const body = JSON.parse(raw || '{}').billing_requests ?? {}
        state.billingRequestBodies.push(body)
        const billingRequest = { id: stubId('BRQ'), status: 'pending', created_at: new Date().toISOString(), metadata: body.metadata ?? {}, links: {} }
        state.billingRequests.push(billingRequest)
        return send(201, { billing_requests: billingRequest })
      }
      const brCancel = path.match(/^\/billing_requests\/([^/]+)\/actions\/cancel$/)
      if (brCancel) {
        const billingRequest = state.billingRequests.find((b) => b.id === brCancel[1])
        if (!billingRequest) return send(404, { error: { message: 'not found' } })
        billingRequest.status = 'cancelled'
        return send(200, { billing_requests: billingRequest })
      }
      if (path.startsWith('/billing_requests/')) return one('billing_requests', state.billingRequests, path.split('/')[2]!)
      if (path === '/billing_request_flows' && req.method === 'POST') {
        const body = JSON.parse(raw || '{}').billing_request_flows ?? {}
        state.flowBodies.push(body)
        const id = stubId('BRF')
        return send(201, {
          billing_request_flows: { id, authorisation_url: `http://127.0.0.1:${GOCARDLESS_STUB_PORT}/flow/${id}`, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(), links: body.links },
        })
      }

      if (path === '/refunds' && req.method === 'POST') {
        if (state.refundsForbidden) return send(403, { error: { message: 'Forbidden request', type: 'invalid_api_usage', errors: [{ reason: 'forbidden' }] } })
        const body = JSON.parse(raw || '{}').refunds ?? {}
        state.refundBodies.push(body)
        const refund = { id: stubId('RF'), status: 'created', currency: 'EUR', created_at: new Date().toISOString(), ...body }
        state.refunds.push(refund)
        // What GoCardless's payment then reports as refunded so far.
        const payment = state.payments.find((p) => p.id === body.links?.payment)
        if (payment) payment.amount_refunded = (payment.amount_refunded ?? 0) + (body.amount ?? 0)
        return send(201, { refunds: refund })
      }
      if (path.startsWith('/refunds/')) return one('refunds', state.refunds, path.split('/')[2]!)

      return send(404, { error: { message: `stub has no route for ${req.method} ${path}` } })
    })
  })

  await new Promise<void>((resolve) => server!.listen(GOCARDLESS_STUB_PORT, '127.0.0.1', () => resolve()))
  return { baseUrl: `http://127.0.0.1:${GOCARDLESS_STUB_PORT}` }
}

async function stopGoCardlessStub() {
  const s = server
  server = null
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
  return { ok: true }
}

/** Change what the stub holds mid-test: a payment GoCardless now reports, a subscription cancelled elsewhere. */
async function updateGoCardlessStub(patch: Partial<StubState>) {
  state = { ...state, ...patch }
  return { ok: true }
}

async function goCardlessStubState() {
  return {
    revoked: state.revoked,
    created: state.created,
    cancelled: state.cancelled,
    billingRequests: state.billingRequests,
    billingRequestBodies: state.billingRequestBodies,
    flowBodies: state.flowBodies,
    refundBodies: state.refundBodies,
    authorizeQueries: state.authorizeQueries,
    customerUpdates: state.customerUpdates,
    requests: state.requests,
  }
}

/** The patient signs: the newest Billing Request is fulfilled with this mandate. Returns its id. */
async function fulfilGoCardlessBillingRequest(opts: { mandateId: string; customerId: string }) {
  const billingRequest = state.billingRequests[state.billingRequests.length - 1]
  if (!billingRequest) throw new Error('no billing request to fulfil')
  billingRequest.status = 'fulfilled'
  billingRequest.links = { customer: opts.customerId, mandate_request_mandate: opts.mandateId }
  return billingRequest.id as string
}

/** The Webhook-Signature GoCardless would send for this body. */
async function signGoCardlessWebhook(opts: { body: string; secret: string }) {
  return createHmac('sha256', opts.secret).update(opts.body).digest('hex')
}

export const gocardlessTasks = {
  'gc:start': startGoCardlessStub,
  'gc:stop': stopGoCardlessStub,
  'gc:update': updateGoCardlessStub,
  'gc:state': goCardlessStubState,
  'gc:sign': signGoCardlessWebhook,
  'gc:fulfil': fulfilGoCardlessBillingRequest,
}
