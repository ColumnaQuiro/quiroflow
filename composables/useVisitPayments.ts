import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'
import type { Database } from '~/types/database.types'

// How each of a set of visits was paid for, keyed by appointment id.
//
// Four tables, in three rounds: the first two are independent, payments need
// the invoice ids, facturas need the payment ids. Shared by the patient's
// Appointments tab and the calendar, which both need the same answer for a
// screenful of visits -- see utils/visitPayment for the rules that turn the
// rows into one.
export function useVisitPayments() {
  const supabase = useSupabaseClient()
  return { fetchVisitPayments: (appointmentIds: string[]) => fetchVisitPayments(supabase, appointmentIds) }
}

async function fetchVisitPayments(supabase: ReturnType<typeof useSupabaseClient<Database>>, appointmentIds: string[]): Promise<Record<string, VisitPayment>> {
  if (appointmentIds.length === 0) return {}

  const [{ data: sessions }, { data: invoices }] = await Promise.all([
    supabase
      .from('package_sessions')
      .select('appointment_id, amount_cents, external_reference, package_purchases(package_name, sessions_total, sessions_used, external_reference)')
      .in('appointment_id', appointmentIds),
    supabase.from('invoices').select('id, appointment_id, invoice_number, total_cents, status').in('appointment_id', appointmentIds),
  ])

  const invoiceIds = (invoices ?? []).map((i) => i.id)
  const { data: payments } = invoiceIds.length
    ? await supabase.from('payments').select('id, invoice_id, method, amount_cents').in('invoice_id', invoiceIds).order('paid_at')
    : { data: [] as { id: string; invoice_id: string | null; method: string; amount_cents: number }[] }

  const paymentIds = (payments ?? []).map((p) => p.id)
  const { data: facturas } = paymentIds.length
    ? await supabase.from('facturas').select('payment_id, number').in('payment_id', paymentIds)
    : { data: [] as { payment_id: string | null; number: string }[] }

  const sessionByAppointment = new Map<string, any>()
  for (const s of sessions ?? []) if (s.appointment_id) sessionByAppointment.set(s.appointment_id, s)

  const paymentsByInvoice = new Map<string, { id: string; method: string; amount_cents: number }[]>()
  for (const p of payments ?? []) {
    if (!p.invoice_id) continue
    const list = paymentsByInvoice.get(p.invoice_id) ?? []
    list.push(p)
    paymentsByInvoice.set(p.invoice_id, list)
  }

  const facturaByPayment = new Map<string, string>()
  for (const f of facturas ?? []) if (f.payment_id) facturaByPayment.set(f.payment_id, f.number)

  const resolved: Record<string, VisitPayment> = {}
  for (const id of appointmentIds) {
    const session = sessionByAppointment.get(id)
    const invoice = (invoices ?? []).find((i) => i.appointment_id === id) ?? null
    const invoicePayments = invoice ? (paymentsByInvoice.get(invoice.id) ?? []) : []
    resolved[id] = resolveVisitPayment({
      session: session ? { amount_cents: session.amount_cents, external_reference: session.external_reference } : null,
      purchase: session?.package_purchases ?? null,
      invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
      payments: invoicePayments.map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
      facturaNumbers: invoicePayments.map((p) => facturaByPayment.get(p.id)).filter((n): n is string => !!n),
    })
  }
  return resolved
}
