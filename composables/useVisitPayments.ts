import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'
import type { Database } from '~/types/database.types'

// How each of a set of visits was paid for, keyed by appointment id.
//
// Four tables in one round: the bono sessions, and the invoices with their
// payments and each payment's factura embedded. It used to be three rounds --
// payments waited for the invoice ids, facturas for the payment ids -- and
// every screen that shows this (the calendar, the appointment panel, the
// patient's visits) waited on all three in series. Shared by the patient's
// Appointments tab and the calendar, which both need the same answer for a
// screenful of visits -- see utils/visitPayment for the rules that turn the
// rows into one.
export function useVisitPayments() {
  const supabase = useSupabaseClient()
  return { fetchVisitPayments: (appointmentIds: string[]) => fetchVisitPayments(supabase, appointmentIds) }
}

async function fetchVisitPayments(supabase: ReturnType<typeof useSupabaseClient<Database>>, appointmentIds: string[]): Promise<Record<string, VisitPayment>> {
  if (appointmentIds.length === 0) return {}

  // Id lists go through fetchByIds: a calendar week can hold hundreds of
  // visits, past what one URL carries.
  const [sessions, invoices] = await Promise.all([
    fetchByIds(appointmentIds, (chunk) =>
      supabase
        .from('package_sessions')
        .select('appointment_id, amount_cents, external_reference, package_purchases(package_name, sessions_total, sessions_used, external_reference)')
        .in('appointment_id', chunk),
    ),
    // Named foreign key: invoices and payments are related twice (a refund
    // invoice also points at the payment it refunds). Payments in the order
    // they were taken.
    fetchByIds(appointmentIds, (chunk) =>
      supabase
        .from('invoices')
        .select('id, appointment_id, invoice_number, total_cents, status, payments!payments_invoice_id_fkey(id, method, amount_cents, paid_at, facturas(number))')
        .in('appointment_id', chunk)
        .order('paid_at', { referencedTable: 'payments' }),
    ),
  ])

  const sessionByAppointment = new Map<string, any>()
  for (const s of sessions) if (s.appointment_id) sessionByAppointment.set(s.appointment_id, s)

  const resolved: Record<string, VisitPayment> = {}
  for (const id of appointmentIds) {
    const session = sessionByAppointment.get(id)
    const invoice = invoices.find((i) => i.appointment_id === id) ?? null
    const invoicePayments = invoice?.payments ?? []
    resolved[id] = resolveVisitPayment({
      session: session ? { amount_cents: session.amount_cents, external_reference: session.external_reference } : null,
      purchase: session?.package_purchases ?? null,
      invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
      payments: invoicePayments.map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
      // One factura per payment (payment_id is unique), so PostgREST embeds
      // an object rather than a list; concat accepts either.
      facturaNumbers: invoicePayments.flatMap((p) => ([] as { number: string }[]).concat(p.facturas ?? []).map((f) => f.number)).filter((n): n is string => !!n),
    })
  }
  return resolved
}
