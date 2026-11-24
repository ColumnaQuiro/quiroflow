import { describe, expect, it } from 'vitest'
import {
  planLedger,
  practiceHubCents,
  practiceHubInvoiceNumber,
  practiceHubLedgerRows,
  practiceHubPaymentMethodKey,
  SETTLE_BATCH,
  type PracticeHubLedgerInput,
} from '../../utils/practicehubImport/ledger'
import type { PracticeHubSnapshot } from '../../utils/practicehubImport/types'

// The PracticeHub Ledger step as the server runs it: what it plans from a copy
// of PracticeHub against what is already here, and what Apply writes --
// against a database kept in memory that answers only the PostgREST calls the
// step makes. The people are invented.

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>, settle: { pending: number; calls: { p_account_id: string; p_limit: number }[] }) {
  const from = (table: string) => {
    const rows = () => (tables[table] ??= [])
    const q = { op: 'select', values: undefined as unknown, filters: [] as [string, string, unknown][], range: null as [number, number] | null, count: false }
    const match = (r: Row) => q.filters.every(([kind, col, v]) =>
      kind === 'eq' ? r[col] === v
        : kind === 'is' ? (r[col] ?? null) === v
          : kind === 'not' ? (r[col] ?? null) !== v
          : String(r[col] ?? '').startsWith(String(v).replace(/%$/, '')))
    const run = () => {
      if (q.op === 'insert') {
        const added = ([] as Row[]).concat(q.values as Row[]).map((v, i) => ({ id: `${table}-${rows().length + i + 1}`, ...v }))
        rows().push(...added)
        return { data: added, error: null }
      }
      if (q.op === 'update') {
        const hit = rows().filter(match)
        for (const r of hit) Object.assign(r, q.values)
        return { data: hit, error: null }
      }
      const found = rows().filter(match)
      const page = q.range ? found.slice(q.range[0], q.range[1] + 1) : found
      return { data: page, error: null, count: q.count ? found.length : null }
    }
    const filter = (kind: string) => (col: string, v: unknown) => { q.filters.push([kind, col, v]); return b }
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string }) => { if (opts?.count) q.count = true; return b },
      order: () => b,
      insert: (v: unknown) => { q.op = 'insert'; q.values = v; return b },
      update: (v: unknown) => { q.op = 'update'; q.values = v; return b },
      eq: filter('eq'),
      is: filter('is'),
      like: filter('like'),
      not: (col: string, _op: string, v: unknown) => { q.filters.push(['not', col, v]); return b },
      range: (a: number, z: number) => { q.range = [a, z]; return b },
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    }
    return b
  }
  // settle_imported_invoices: changes at most p_limit of what is pending.
  const rpc = async (name: string, args: { p_account_id: string; p_limit: number }) => {
    if (name !== 'settle_imported_invoices') throw new Error(name)
    settle.calls.push(args)
    const n = Math.min(settle.pending, args.p_limit)
    settle.pending -= n
    return { data: n, error: null }
  }
  return { from, rpc }
}

const ACCOUNT = 'acc'
const OTHER = 'other-acc'
const t = (en: string) => en

// PracticeHub: two patients, three invoices (one with its visit's id, one
// raised the same day as a visit entered in QuiroFlow, one for a patient not
// here yet), and three payments.
function snapshot(): PracticeHubSnapshot {
  return {
    readAt: '2026-11-18T10:00:00Z',
    baseUrl: 'https://demo.practicehub.io',
    lists: {
      '/payment_methods': [{ id: 1, name: 'Cash' }, { id: 2, name: 'Credit Card' }, { id: 3, name: 'GoCardless - Direct Debit Payments' }],
      '/patients': [{ id: 11, patient_number: '1001' }, { id: 12, patient_number: '1002' }, { id: 13, patient_number: '1003' }],
      '/invoices': [
        { id: 501, appointment_id: '9001', patient_id: '11', total: '45.00', created: '2026-09-01T10:00:00Z' },
        { id: 502, appointment_id: '9999', patient_id: '12', total: '30.50', created: '2026-09-09T14:34:44Z' },
        { id: 503, appointment_id: null, patient_id: '13', total: '20.00', created: '2026-09-10T09:00:00Z' },
      ],
      '/payments': [
        { id: 701, amount: '45.00', payment_type_id: '1', patient_id: '11', note: 'efectivo', created: '2026-09-01T10:05:00Z' },
        { id: 702, amount: '100.00', payment_type_id: '3', patient_id: '12', note: null, created: '2026-09-09T14:40:00Z' },
        { id: 703, amount: '10.00', payment_type_id: '2', patient_id: '13', note: null, created: '2026-09-10T09:05:00Z' },
      ],
    },
  }
}

function clinic(): Record<string, Row[]> {
  return {
    clinics: [{ id: 'c1', account_id: ACCOUNT, timezone: 'Europe/Madrid' }],
    patients: [
      { id: 'p1', account_id: ACCOUNT, external_reference: '1001' },
      { id: 'p2', account_id: ACCOUNT, external_reference: '1002' },
      // Another clinic's patient with the same Patient Number: never matched.
      { id: 'x3', account_id: OTHER, external_reference: '1003' },
    ],
    appointments: [
      { id: 'a1', account_id: ACCOUNT, external_reference: '9001', patient_id: 'p1', starts_at: '2026-09-01T09:30:00Z', status: 'completed', clinic_id: 'c1' },
      // Entered in QuiroFlow: no PracticeHub id, found by its date.
      { id: 'a2', account_id: ACCOUNT, external_reference: null, patient_id: 'p2', starts_at: '2026-09-09T12:45:00Z', status: 'completed', clinic_id: 'c1' },
    ],
    invoices: [
      // Another clinic's PracticeHub import: its refs must not count as here.
      { id: 'xi', account_id: OTHER, external_reference: 'phinv-501', appointment_id: null, patient_id: 'x3', created_at: '2026-09-01T10:00:00Z' },
    ],
    payments: [{ id: 'xp', account_id: OTHER, external_reference: 'phpay-701' }],
  }
}

async function plan(tables: Record<string, Row[]>, settle = { pending: 0, calls: [] as { p_account_id: string; p_limit: number }[] }) {
  const supabase = fakeSupabase(tables, settle)
  return planLedger({ supabase: supabase as never, accountId: ACCOUNT, clinicId: 'c1', defaultPhoneCountry: 'ES', t, files: null }, snapshot())
}

describe('the helpers the browser importer shares', () => {
  it('reads PracticeHub amounts as cents', () => {
    expect(practiceHubCents('45.00')).toBe(4500)
    expect(practiceHubCents('30.505')).toBe(3051)
    expect(practiceHubCents(null)).toBe(0)
  })

  it('maps free-text payment methods onto card, cash or other', () => {
    expect(practiceHubPaymentMethodKey('Cash')).toBe('cash')
    expect(practiceHubPaymentMethodKey('Credit Card')).toBe('card')
    expect(practiceHubPaymentMethodKey('Bizum')).toBe('other')
    // As the browser importer always has: the name contains "card".
    expect(practiceHubPaymentMethodKey('GoCardless - Direct Debit Payments')).toBe('card')
  })

  it('numbers imported invoices in their own PHI- series', () => {
    expect(practiceHubInvoiceNumber('phinv-7202')).toBe('PHI-7202')
  })
})

describe('what the ledger plans, without the database', () => {
  const base = (): PracticeHubLedgerInput => {
    const s = snapshot().lists
    return {
      methods: s['/payment_methods'] as never,
      patients: s['/patients'] as never,
      invoices: s['/invoices'] as never,
      payments: s['/payments'] as never,
      ourPatients: [{ id: 'p1', external_reference: '1001' }, { id: 'p2', external_reference: '1002' }],
      ourAppointments: clinic().appointments!.map((a) => a as never),
      ourInvoices: [],
      havePaymentRefs: new Set(),
      timezoneOfClinic: () => 'Europe/Madrid',
    }
  }

  it('links by PracticeHub id first and by the day otherwise, and skips patients not here', () => {
    const r = practiceHubLedgerRows(base())
    expect(r.invoices.map((i) => [i.ref, i.patientId, i.appointmentId, i.totalCents])).toEqual([
      ['phinv-501', 'p1', 'a1', 4500],
      ['phinv-502', 'p2', 'a2', 3050],
    ])
    expect(r.payments.map((p) => [p.ref, p.method, p.amountCents])).toEqual([['phpay-701', 'cash', 4500], ['phpay-702', 'card', 10000]])
    expect(r.skipped).toEqual({ invoicesAlready: 0, paymentsAlready: 0, invoicesUnmatched: 1, paymentsUnmatched: 1 })
    expect(r.phTotals).toEqual({ invoicedCents: 9550, paidCents: 15500 })
  })

  it('skips what is already here by its reference, and links an earlier invoice that arrived without its visit', () => {
    const input = base()
    input.ourInvoices = [{ id: 'i502', external_reference: 'phinv-502', appointment_id: null, patient_id: 'p2', created_at: '2026-09-09T14:34:44Z' }]
    input.havePaymentRefs = new Set(['phpay-701'])
    const r = practiceHubLedgerRows(input)
    expect(r.invoices.map((i) => i.ref)).toEqual(['phinv-501'])
    expect(r.invoicesToLink).toEqual([{ id: 'i502', ref: 'phinv-502', appointmentId: 'a2' }])
    expect(r.skipped.invoicesAlready).toBe(1)
    expect(r.skipped.paymentsAlready).toBe(1)
  })

  it('does not link by date to a visit another invoice here already has', () => {
    const input = base()
    input.ourInvoices = [{ id: 'native', external_reference: null, appointment_id: 'a2', patient_id: 'p2', created_at: '2026-09-09T12:00:00Z' }]
    const r = practiceHubLedgerRows(input)
    expect(r.invoices.find((i) => i.ref === 'phinv-502')!.appointmentId).toBeNull()
  })

  it('reads the day at the clinic, not in UTC: 00:30 in Madrid is the next day', () => {
    const input = base()
    input.invoices = [{ id: 600, appointment_id: null, patient_id: '12', total: '30.00', created: '2026-09-09T22:30:00Z' }]
    input.ourAppointments = [{ id: 'late', external_reference: null, patient_id: 'p2', starts_at: '2026-09-09T22:00:00Z', status: 'completed', clinic_id: 'c1' }]
    expect(practiceHubLedgerRows(input).invoices[0]!.appointmentId).toBe('late')
    input.ourAppointments = [{ id: 'eve', external_reference: null, patient_id: 'p2', starts_at: '2026-09-09T18:00:00Z', status: 'completed', clinic_id: 'c1' }]
    expect(practiceHubLedgerRows(input).invoices[0]!.appointmentId).toBeNull()
  })
})

describe('the Ledger step on the server', () => {
  it('plans only from this account and writes every row with it', async () => {
    const tables = clinic()
    const settle = { pending: 2, calls: [] as { p_account_id: string; p_limit: number }[] }
    const p = await plan(tables, settle)
    // Two invoices, two payments, settlement.
    expect(p.total).toBe(5)
    const result = await p.apply(() => {}, () => false)
    expect(result).toEqual({ written: 6, errors: [] })

    const mine = tables.invoices!.filter((i) => i.account_id === ACCOUNT)
    expect(mine.map((i) => [i.external_reference, i.invoice_number, i.appointment_id, i.status, i.total_cents])).toEqual([
      ['phinv-501', 'PHI-501', 'a1', 'unpaid', 4500],
      ['phinv-502', 'PHI-502', 'a2', 'unpaid', 3050],
    ])
    const paid = tables.payments!.filter((x) => x.account_id === ACCOUNT)
    expect(paid.map((x) => [x.external_reference, x.patient_id, x.invoice_id, x.method, x.amount_cents])).toEqual([
      ['phpay-701', 'p1', null, 'cash', 4500],
      ['phpay-702', 'p2', null, 'card', 10000],
    ])
    expect(settle.calls).toEqual([{ p_account_id: ACCOUNT, p_limit: SETTLE_BATCH }])
  })

  it('run again, writes nothing new but still settles', async () => {
    const tables = clinic()
    await (await plan(tables)).apply(() => {}, () => false)
    const settle = { pending: 0, calls: [] as { p_account_id: string; p_limit: number }[] }
    const again = await plan(tables, settle)
    expect(again.total).toBe(1)
    expect(await again.apply(() => {}, () => false)).toEqual({ written: 0, errors: [] })
    expect(settle.calls).toHaveLength(1)
  })

  it('settles in batches until a call changes fewer than the batch', async () => {
    const tables = clinic()
    const settle = { pending: SETTLE_BATCH * 2 + 5, calls: [] as { p_account_id: string; p_limit: number }[] }
    const result = await (await plan(tables, settle)).apply(() => {}, () => false)
    expect(settle.calls).toHaveLength(3)
    expect(settle.pending).toBe(0)
    expect(result.written).toBe(4 + SETTLE_BATCH * 2 + 5)
  })

  it('a slice stopped part way through settling leaves a plan that settles the rest', async () => {
    const tables = clinic()
    const settle = { pending: SETTLE_BATCH * 3, calls: [] as { p_account_id: string; p_limit: number }[] }
    // Stops after the first settlement call.
    const first = await (await plan(tables, settle)).apply(() => {}, () => settle.calls.length >= 1)
    expect(first.written).toBe(4 + SETTLE_BATCH)
    expect(settle.pending).toBe(SETTLE_BATCH * 2)

    const next = await plan(tables, settle)
    expect(next.total).toBe(1)
    await next.apply(() => {}, () => false)
    expect(settle.pending).toBe(0)
  })

  it('a slice stopped before writing anything writes it all next time, and settles once at the end', async () => {
    const tables = clinic()
    const settle = { pending: 0, calls: [] as { p_account_id: string; p_limit: number }[] }
    expect(await (await plan(tables, settle)).apply(() => {}, () => true)).toEqual({ written: 0, errors: [] })
    expect(tables.invoices!.filter((i) => i.account_id === ACCOUNT)).toHaveLength(0)
    expect(settle.calls).toHaveLength(0)

    const done: number[] = []
    const next = await plan(tables, settle)
    await next.apply((n) => done.push(n), () => false)
    expect(done.at(-1)).toBe(next.total)
    expect(settle.calls).toHaveLength(1)
  })

  it('links an invoice imported earlier without its visit, and never one linked by hand since', async () => {
    const tables = clinic()
    tables.invoices!.push({ id: 'i502', account_id: ACCOUNT, external_reference: 'phinv-502', appointment_id: null, patient_id: 'p2', created_at: '2026-09-09T14:34:44Z' })
    const p = await plan(tables)
    expect(p.warnings.some((w) => w.includes('1 invoices already imported without their visit'))).toBe(true)
    // Someone links it by hand between the plan and the write.
    tables.invoices!.find((i) => i.id === 'i502')!.appointment_id = 'by-hand'
    await p.apply(() => {}, () => false)
    expect(tables.invoices!.find((i) => i.id === 'i502')!.appointment_id).toBe('by-hand')
  })

  it('does not settle an account with no PracticeHub invoices at all', async () => {
    const tables = clinic()
    tables.patients = tables.patients!.filter((x) => x.account_id === OTHER)
    const settle = { pending: 0, calls: [] as { p_account_id: string; p_limit: number }[] }
    const p = await plan(tables, settle)
    expect(p.total).toBe(0)
    await p.apply(() => {}, () => false)
    expect(settle.calls).toHaveLength(0)
  })

  it('adopts a Stripe charge the webhook already booked instead of creating the PracticeHub payment again', async () => {
    const tables = clinic()
    // The Stripe sync booked p2's 100,00 a day before PracticeHub stamped it.
    tables.payments!.push({ id: 'stripe-1', account_id: ACCOUNT, external_reference: null, stripe_invoice_id: 'in_1', patient_id: 'p2', amount_cents: 10000, paid_at: '2026-09-08T09:00:00Z', method: 'card' })
    const p = await plan(tables)
    expect(p.warnings.some((w) => w.includes('1 payments are Stripe charges already recorded here'))).toBe(true)
    await p.apply(() => {}, () => false)
    const mine = tables.payments!.filter((x) => x.account_id === ACCOUNT)
    // One payment for that money, now carrying PracticeHub's reference.
    expect(mine.filter((x) => x.patient_id === 'p2').map((x) => [x.id, x.external_reference])).toEqual([['stripe-1', 'phpay-702']])
    // And the next run sees it as imported.
    const again = await plan(tables)
    expect(again.rows.some((r) => String(r.what).startsWith('Payment'))).toBe(false)
  })

  it('does not adopt a booked charge of a different amount or a week away', async () => {
    const tables = clinic()
    tables.payments!.push({ id: 'stripe-1', account_id: ACCOUNT, external_reference: null, stripe_invoice_id: 'in_1', patient_id: 'p2', amount_cents: 9000, paid_at: '2026-09-09T09:00:00Z', method: 'card' })
    tables.payments!.push({ id: 'stripe-2', account_id: ACCOUNT, external_reference: null, stripe_invoice_id: 'in_2', patient_id: 'p2', amount_cents: 10000, paid_at: '2026-09-16T14:40:00Z', method: 'card' })
    await (await plan(tables)).apply(() => {}, () => false)
    expect(tables.payments!.find((x) => x.external_reference === 'phpay-702')?.id).not.toMatch(/^stripe-/)
  })
})
