import { resolveVisitPayment, type VisitPayment } from '~/utils/visitPayment'
import type { Database } from '~/types/database.types'

// How each of a set of visits was paid for, keyed by appointment id.
//
// Four tables in one request: the bono sessions with their pack, and the
// invoices with their payments and each payment's factura (the
// visit_payment_rows function, which nests them the way PostgREST embedded
// them). It was three rounds once, then two selects side by side, each split
// into chunks of 150 ids to fit a URL; the ids now travel in the body.
// Shared by the patient's Appointments tab, the calendar and the appointment
// panel, which all need the same answer -- see utils/visitPayment for the
// rules that turn the rows into one.
export function useVisitPayments() {
  const supabase = useSupabaseClient()
  return { fetchVisitPayments: (appointmentIds: string[]) => fetchVisitPayments(supabase, appointmentIds) }
}

/** What visit_payment_rows returns; also a key of calendar_range_details and appointment_panel. */
export interface VisitPaymentRows {
  package_sessions: {
    appointment_id: string | null
    amount_cents: number
    external_reference: string | null
    used_at: string
    package_purchases: {
      package_name: string
      sessions_total: number
      sessions_used: number
      external_reference: string | null
      package_sessions: { used_at: string }[]
    } | null
  }[]
  // Payments in the order they were taken. One factura per payment
  // (payment_id is unique), so an object rather than a list; the resolver
  // accepts either.
  invoices: {
    id: string
    appointment_id: string | null
    invoice_number: string
    total_cents: number
    status: string
    payments: { id: string; method: string; amount_cents: number; paid_at: string | null; facturas: { number: string } | { number: string }[] | null }[]
  }[]
}

async function fetchVisitPayments(supabase: ReturnType<typeof useSupabaseClient<Database>>, appointmentIds: string[]): Promise<Record<string, VisitPayment>> {
  if (appointmentIds.length === 0) return {}
  const { data, error } = await supabase.rpc('visit_payment_rows' as never, { p_appointment_ids: appointmentIds } as never)
  if (error) throw error
  return visitPaymentsFromRows(appointmentIds, data as unknown as VisitPaymentRows | null)
}

/** The rows for a set of visits, resolved to one answer per appointment id. */
export function visitPaymentsFromRows(appointmentIds: string[], rows: VisitPaymentRows | null | undefined): Record<string, VisitPayment> {
  const sessions = rows?.package_sessions ?? []
  const invoices = rows?.invoices ?? []

  const sessionByAppointment = new Map<string, VisitPaymentRows['package_sessions'][number]>()
  for (const s of sessions) if (s.appointment_id) sessionByAppointment.set(s.appointment_id, s)

  const resolved: Record<string, VisitPayment> = {}
  for (const id of appointmentIds) {
    const session = sessionByAppointment.get(id)
    const invoice = invoices.find((i) => i.appointment_id === id) ?? null
    const invoicePayments = invoice?.payments ?? []
    resolved[id] = resolveVisitPayment({
      session: session
        ? {
            amount_cents: session.amount_cents,
            external_reference: session.external_reference,
            // The pack's sessions drawn after this one -- see resolveVisitPayment.
            laterSessions: (session.package_purchases?.package_sessions ?? []).filter((s: { used_at: string }) => s.used_at > session.used_at).length,
          }
        : null,
      purchase: session?.package_purchases ?? null,
      invoice: invoice ? { invoice_number: invoice.invoice_number, total_cents: invoice.total_cents, status: invoice.status } : null,
      payments: invoicePayments.map((p) => ({ method: p.method, amount_cents: p.amount_cents })),
      facturaNumbers: invoicePayments.flatMap((p) => ([] as { number: string }[]).concat(p.facturas ?? []).map((f) => f.number)).filter((n): n is string => !!n),
    })
  }
  return resolved
}
