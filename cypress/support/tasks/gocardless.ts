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
}

let server: Server | null = null
let state: StubState = blank()

function blank(): StubState {
  return {
    organisationId: 'OR-STUB',
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
  }
}

async function startGoCardlessStub(opts: Partial<Omit<StubState, 'revoked' | 'created' | 'cancelled'>> = {}) {
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

      if (path === '/creditors') return list('creditors', [{ id: 'CR-STUB', verification_status: state.verificationStatus }])
      if (path === '/customers') return list('customers', state.customers)
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
  return { revoked: state.revoked, created: state.created, cancelled: state.cancelled }
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
}
