// What a clinic took and invoiced today, for the calendar's "Hoy de un
// vistazo" card -- PracticeHub's board shift metrics, beside the visit
// counts already there.
//
// The same rules as Reports > Daily Transactions, not a second reading of
// them: a payment counts when it is a receipt (utils/paymentReceipts -- spent
// credit is not money arriving), its invoice is not void, and it belongs to
// this clinic by the attribution Income and the day sheet share
// (utils/incomeAttribution). Invoiced is today's non-void invoices for the
// clinic, attributed the same way (a refund invoice counts as the negative it
// is). Read under the viewer's own RLS; the calendar shows it only to a role
// that can open the day sheet.
import { isReceipt } from '../utils/paymentReceipts'
import { classifyPaymentForFilter } from '../utils/incomeAttribution'

type Appt = { id: string; practitioner_id: string | null; clinic_id: string | null } | null
type Pat = { id: string; default_practitioner_id: string | null; clinic_id: string | null } | null

export function useDayTakings() {
  const supabase = useSupabaseClient()
  const collectedCents = ref(0)
  const invoicedCents = ref(0)
  const loaded = ref(false)

  let run = 0
  async function load(clinicId: string | null | undefined, start: Date, end: Date) {
    const mine = ++run
    if (!clinicId) {
      collectedCents.value = 0
      invoicedCents.value = 0
      loaded.value = true
      return
    }
    const [{ data: pays }, { data: invs }] = await Promise.all([
      supabase
        .from('payments')
        .select('amount_cents, method, invoices!payments_invoice_id_fkey(status, appointments!invoices_appointment_id_fkey(id, practitioner_id, clinic_id)), patients!payments_patient_id_fkey(id, default_practitioner_id, clinic_id)')
        .gte('paid_at', start.toISOString())
        .lt('paid_at', end.toISOString()),
      supabase
        .from('invoices')
        .select('total_cents, status, appointments!invoices_appointment_id_fkey(id, practitioner_id, clinic_id), patients!invoices_patient_id_fkey(id, default_practitioner_id, clinic_id)')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .neq('status', 'void'),
    ])
    if (mine !== run) return
    const here = (appointment: Appt, patient: Pat) => classifyPaymentForFilter({ clinicId, appointment, patient }) === 'matches'
    collectedCents.value = ((pays as unknown as { amount_cents: number; method: string; invoices: { status: string; appointments: Appt } | null; patients: Pat }[] | null) ?? [])
      .filter((p) => p.invoices?.status !== 'void' && isReceipt(p.method) && here(p.invoices?.appointments ?? null, p.patients))
      .reduce((s, p) => s + p.amount_cents, 0)
    invoicedCents.value = ((invs as unknown as { total_cents: number; appointments: Appt; patients: Pat }[] | null) ?? [])
      .filter((i) => here(i.appointments, i.patients))
      .reduce((s, i) => s + i.total_cents, 0)
    loaded.value = true
  }

  return { collectedCents, invoicedCents, loaded, load }
}
