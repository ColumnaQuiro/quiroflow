import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { fetchAllRows } from './useFetchAllRows'
import { startOfLocalDate } from '../utils/clinicClock'
import { practitionerForPayment } from '../utils/incomeAttribution'
import { isReceipt } from '../utils/paymentReceipts'
import { payFactsByMember, type PayFacts, type PayPlan, type PayTierMode } from '../utils/payPlan'

// One month's pay figures for the team: everyone's pay plan and the facts it
// is worked out from. Shared by Reports › Commissions and the Retribución tab
// of a person's file, so the two can never disagree about what someone earned.
//
// The figures are the reports' own: money is receipts on non-void invoices
// (utils/paymentReceipts), attributed to a practitioner as Income attributes
// it (visit's practitioner, else the patient's own); a visit is an attended
// appointment and belongs to its practitioner; a new patient is one whose
// first attended visit ever is in the month; a sale is a bono or membership,
// to whoever recorded it. The month is the clinic's calendar month.

export interface PayMonthMember { id: string; full_name: string; is_practitioner: boolean }
export interface PayMonth {
  members: PayMonthMember[]
  plans: Map<string, PayPlan>
  facts: Map<string, PayFacts>
  unattributedCents: number
}

/** The lines of computePay, as [English, Spanish]. */
export const PAY_LINE_LABELS: Record<string, [string, string]> = {
  base: ['Fixed', 'Fijo'],
  payments: ['Share of payments', 'Parte de los cobros'],
  visits: ['Visits', 'Visitas'],
  new_patients: ['New patients', 'Pacientes nuevos'],
  sales: ['Bonos and memberships sold', 'Bonos y membresías vendidos'],
}

export const EMPTY_PAY_FACTS: PayFacts = { paymentsCents: 0, visits: 0, newPatients: 0, salesCents: 0 }

/** `month` is YYYY-MM, in the clinic's time zone. */
export function payMonthBounds(month: string, tz: string) {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`
  return { from: startOfLocalDate(`${month}-01`, tz), to: startOfLocalDate(`${next}-01`, tz) }
}

type Supabase = SupabaseClient<Database>
type PlanRow = PayPlan & { team_member_id: string }

export async function loadPayMonth(supabase: Supabase, month: string, tz: string): Promise<PayMonth> {
  const { from, to } = payMonthBounds(month, tz)
  const f0 = from.toISOString()
  const t0 = to.toISOString()
  type Pay = { amount_cents: number; method: string; invoices: { status: string; appointments: { practitioner_id: string | null } | null } | null; patients: { default_practitioner_id: string | null } | null }
  const [m, p, pays, visits, bonos, memberships] = await Promise.all([
    supabase.from('team_members').select('id, full_name, is_practitioner').is('deleted_at', null).order('full_name'),
    supabase.from('pay_plans').select('team_member_id, base_cents, payments_pct, visit_cents, tier_mode, tiers, new_patient_cents, sales_pct'),
    fetchAllRows<Pay>((f, tt) => supabase.from('payments').select('amount_cents, method, invoices!payments_invoice_id_fkey(status, appointments!invoices_appointment_id_fkey(practitioner_id)), patients!payments_patient_id_fkey(default_practitioner_id)').gte('paid_at', f0).lt('paid_at', t0).range(f, tt) as never),
    fetchAllRows<{ practitioner_id: string | null; patient_id: string | null }>((f, tt) => supabase.from('appointments').select('practitioner_id, patient_id').eq('status', 'completed').is('deleted_at', null).gte('starts_at', f0).lt('starts_at', t0).range(f, tt) as never),
    fetchAllRows<{ price_cents: number; created_by: string | null }>((f, tt) => supabase.from('package_purchases').select('price_cents, created_by').gte('purchased_at', f0).lt('purchased_at', t0).range(f, tt) as never),
    fetchAllRows<{ price_cents: number; created_by: string | null }>((f, tt) => supabase.from('patient_memberships').select('price_cents, created_by').gte('started_at', f0).lt('started_at', t0).range(f, tt) as never),
  ])
  // Who had been in before the month: their visit this month is not a first.
  const patientIds = [...new Set(visits.map((v) => v.patient_id).filter((x): x is string => !!x))]
  const seenBefore = new Set<string>()
  for (let i = 0; i < patientIds.length; i += 200) {
    const { data } = await supabase.from('appointments').select('patient_id').eq('status', 'completed').is('deleted_at', null).lt('starts_at', f0).in('patient_id', patientIds.slice(i, i + 200))
    for (const r of (data as { patient_id: string }[] | null) ?? []) seenBefore.add(r.patient_id)
  }
  const receipts = pays.filter((x) => x.invoices?.status !== 'void' && isReceipt(x.method))
  const attributed = receipts.map((x) => ({
    cents: x.amount_cents,
    practitionerId: practitionerForPayment({ appointment: x.invoices?.appointments ? { practitioner_id: x.invoices.appointments.practitioner_id, clinic_id: null } : null, patient: x.patients ? { default_practitioner_id: x.patients.default_practitioner_id, clinic_id: null } : null }),
  }))
  return {
    members: (m.data as PayMonthMember[] | null) ?? [],
    plans: new Map(((p.data as unknown as PlanRow[] | null) ?? []).map((r) => [r.team_member_id, { ...r, payments_pct: Number(r.payments_pct), sales_pct: Number(r.sales_pct), tier_mode: r.tier_mode as PayTierMode, tiers: Array.isArray(r.tiers) ? r.tiers : [] }])),
    facts: payFactsByMember({
      payments: attributed,
      visits: visits.map((v) => ({ practitionerId: v.practitioner_id, patientId: v.patient_id })),
      seenBefore,
      sales: [...bonos, ...memberships].map((s) => ({ cents: s.price_cents, soldBy: s.created_by })),
    }),
    unattributedCents: attributed.filter((x) => !x.practitionerId).reduce((s, x) => s + x.cents, 0),
  }
}
