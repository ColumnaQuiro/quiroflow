import { describe, expect, it, vi } from 'vitest'
import { recordBonoSale, bonoSaleDefaultCents } from '../../utils/bonoSale'

// utils/bonoSale is what the patient record (web and app) and the visit
// checkout all sell a bono through. These pin the rules it carries, against a
// fake client that records every write.

type Row = Record<string, unknown>
const TEMPLATE = { id: 'tpl-1', name: 'Bono 12', session_count: 12, price_cents: 52800, installment_options: [{ installments: 2, installment_cents: 27000 }] }

function fakeSupabase(opts: { template?: Row | null; refusePayment?: boolean } = {}) {
  const writes: { table: string; row: Row }[] = []
  const client = {
    from(table: string) {
      return {
        select() {
          return { eq: () => ({ maybeSingle: async () => ({ data: opts.template === undefined ? TEMPLATE : opts.template, error: null }) }) }
        },
        insert(row: Row) {
          writes.push({ table, row })
          const refused = table === 'payments' && opts.refusePayment
          const data =
            table === 'package_purchases'
              ? { id: 'purchase-1', package_name: row.package_name, sessions_used: 0, sessions_total: row.sessions_total, price_cents: row.price_cents }
              : { id: `${table}-id` }
          const result = refused ? { data: null, error: { message: 'denied' } } : { data, error: null }
          // Awaited directly (account_credits) or through .select().single().
          return Object.assign(Promise.resolve({ error: null }), { select: () => ({ single: async () => result }) })
        },
      }
    },
  }
  return { client, writes }
}

const t = (en: string) => en
const base = {
  accountId: 'acc',
  patientId: 'pat',
  teamMemberId: 'tm',
  packageId: 'tpl-1',
  installments: 1,
  amountCents: 52800,
  method: 'cash',
  spendableCreditCents: 0,
  creditLedgerCents: 0,
}

describe('recordBonoSale', () => {
  it('sells at the price read now, owed on the bono, with no invoice, and a factura for the money', async () => {
    const { client, writes } = fakeSupabase()
    const issueFactura = vi.fn(async () => null)
    const result = await recordBonoSale(client, { issueFactura, t }, base)

    expect(result.error).toBeNull()
    expect(result.purchase?.id).toBe('purchase-1')
    const purchase = writes.find((w) => w.table === 'package_purchases')!.row
    expect(purchase).toMatchObject({ price_cents: 52800, owed_cents: 52800, invoice_id: null, sessions_total: 12, created_by: 'tm' })
    const payment = writes.find((w) => w.table === 'payments')!.row
    expect(payment).toMatchObject({ package_purchase_id: 'purchase-1', invoice_id: null, amount_cents: 52800, purpose: 'bono' })
    expect(writes.some((w) => w.table === 'invoices')).toBe(false)
    expect(issueFactura).toHaveBeenCalledOnce()
  })

  it('sells in plazos at the option price, and refuses an option no longer offered', async () => {
    const { client, writes } = fakeSupabase()
    const ok = await recordBonoSale(client, { issueFactura: async () => null, t }, { ...base, installments: 2, amountCents: 27000 })
    expect(ok.error).toBeNull()
    expect(writes.find((w) => w.table === 'package_purchases')!.row).toMatchObject({ price_cents: 54000, installments: 2, installment_cents: 27000 })

    const gone = fakeSupabase()
    const result = await recordBonoSale(gone.client, { issueFactura: async () => null, t }, { ...base, installments: 3 })
    expect(result.purchase).toBeNull()
    expect(result.optionGone).toBe(true)
    expect(gone.writes).toHaveLength(0)
  })

  it('writes nothing when paying more credit than the patient can spend', async () => {
    const { client, writes } = fakeSupabase()
    const result = await recordBonoSale(client, { issueFactura: async () => null, t }, { ...base, method: 'credit', amountCents: 10000, spendableCreditCents: 5000 })
    expect(result.purchase).toBeNull()
    expect(result.error).toMatch(/more than/)
    expect(writes).toHaveLength(0)
  })

  it('pays with credit: no factura, and only the ledger part drawn down', async () => {
    const { client, writes } = fakeSupabase()
    const issueFactura = vi.fn(async () => null)
    await recordBonoSale(client, { issueFactura, t }, { ...base, method: 'credit', amountCents: 5000, spendableCreditCents: 8000, creditLedgerCents: 3000 })
    expect(issueFactura).not.toHaveBeenCalled()
    expect(writes.find((w) => w.table === 'account_credits')!.row).toMatchObject({ amount_cents: -3000 })
  })

  it('still reports the bono as sold when its payment is refused, with nothing else written', async () => {
    const { client, writes } = fakeSupabase({ refusePayment: true })
    const issueFactura = vi.fn(async () => null)
    const result = await recordBonoSale(client, { issueFactura, t }, base)
    expect(result.purchase?.id).toBe('purchase-1')
    expect(result.error).toMatch(/payment could not be recorded: denied/)
    expect(issueFactura).not.toHaveBeenCalled()
    expect(writes.some((w) => w.table === 'account_credits')).toBe(false)
  })

  it('sells nothing for a bono that no longer exists', async () => {
    const { client, writes } = fakeSupabase({ template: null })
    const result = await recordBonoSale(client, { issueFactura: async () => null, t }, base)
    expect(result.purchase).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('takes no payment when nothing is paid now', async () => {
    const { client, writes } = fakeSupabase()
    const result = await recordBonoSale(client, { issueFactura: async () => null, t }, { ...base, amountCents: 0 })
    expect(result.purchase).not.toBeNull()
    expect(writes.map((w) => w.table)).toEqual(['package_purchases'])
  })
})

describe('bonoSaleDefaultCents', () => {
  it('opens on the price, or the first plazo', () => {
    expect(bonoSaleDefaultCents(TEMPLATE, 1)).toBe(52800)
    expect(bonoSaleDefaultCents(TEMPLATE, 2)).toBe(27000)
    expect(bonoSaleDefaultCents(null, 1)).toBe(0)
  })
})
