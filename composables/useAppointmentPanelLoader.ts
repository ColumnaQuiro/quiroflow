import type { PanelAppointment } from '~/components/calendar/AppointmentPanel.vue'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'
import type { AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { effectivePriceCents } from '~/utils/appointmentOverrides'
import { appointmentStage, needsNextBookingFlag } from '~/utils/appointmentStage'
import { shortPatientName } from '~/utils/appointmentBlock'
import { bonoForVisit, type VisitPayment } from '~/utils/visitPayment'
import { formatTime } from '~/utils/billing'

// Everything CalendarAppointmentPanel needs, for ONE visit.
//
// The calendar already holds these for a whole week (balances, bonos, visit
// payments, moves, overrides) because every block draws them, so it builds
// the panel's props from what it has. A screen that opens a single visit --
// the practitioner's day -- has none of that loaded, and loading a week of
// it to open one panel would be backwards. This fetches the same facts for
// one appointment, read the same way (utils/appointmentStage,
// utils/visitPayment, effectivePriceCents), so the panel says the same thing
// whichever screen opened it.

export interface AppointmentPanelInputs {
  appointment: PanelAppointment & { appointment_types: { name: string; color: string; default_price_cents: number } | null }
  view: BlockView
  payment: VisitPayment
  priceCents: number
  overrides: AppointmentTypeOverride[]
}

const SELECT =
  'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, confirmation_sent_at, reminder_sent_at, same_day_info_sent_at, created_at, deleted_at, note, source, patients(first_name, last_name, sticky_note), appointment_types(name, color, default_price_cents), team_members(full_name, color)'

export function useAppointmentPanelLoader() {
  const supabase = useSupabaseClient()
  const { fetchVisitPayments } = useVisitPayments()

  async function load(appointmentId: string): Promise<AppointmentPanelInputs | null> {
    const { data: row } = await supabase.from('appointments').select(SELECT).eq('id', appointmentId).maybeSingle()
    if (!row) return null
    const a = row as unknown as AppointmentPanelInputs['appointment']

    const [payments, { data: balance }, { data: packages }, { count: moved }, { data: later }, { data: overrides }] = await Promise.all([
      fetchVisitPayments([a.id]),
      supabase.from('patient_live_balances').select('outstanding_cents').eq('patient_id', a.patient_id).maybeSingle(),
      supabase.from('package_purchases').select('package_name, sessions_total, sessions_used, is_closed').eq('patient_id', a.patient_id).order('purchased_at', { ascending: false }),
      supabase.from('appointment_reschedules').select('id', { count: 'exact', head: true }).eq('appointment_id', a.id),
      // The calendar's rule for "has a next visit" (loadFutureAppointmentIds): any
      // visit not cancelled, from now on, other than this one.
      supabase.from('appointments').select('id').eq('patient_id', a.patient_id).neq('status', 'cancelled').gt('starts_at', new Date().toISOString()).neq('id', a.id).limit(1),
      supabase.from('appointment_type_overrides').select('appointment_type_id, team_member_id, duration_minutes, price_cents'),
    ])

    const payment: VisitPayment = payments[a.id] ?? { kind: 'none' }
    // Same rule as the calendar: the newest pack that is neither closed nor used up.
    const active = (packages ?? []).find((p) => !p.is_closed && p.sessions_used < p.sessions_total) ?? null
    const stage = appointmentStage(a)
    const ovr = (overrides ?? []) as AppointmentTypeOverride[]

    const view: BlockView = {
      id: a.id,
      name: `${a.patients?.first_name ?? ''} ${a.patients?.last_name ?? ''}`.trim(),
      shortName: shortPatientName(a.patients?.first_name, a.patients?.last_name),
      stage,
      arrivedAt: a.checked_in_at ? formatTime(a.checked_in_at) : null,
      timeLabel: formatTime(a.starts_at),
      typeName: a.appointment_types?.name ?? null,
      typeColor: a.appointment_types?.color ?? null,
      practitionerName: (a.team_members?.full_name ?? '').trim().split(/\s+/)[0] || null,
      owesCents: Math.max(0, balance?.outstanding_cents ?? 0),
      bono: bonoForVisit(payment, active),
      hasNote: !!a.patients?.sticky_note?.trim(),
      movedCount: moved ?? 0,
      noNext: needsNextBookingFlag(stage, a.starts_at, (later ?? []).length > 0),
    }
    const priceCents =
      a.appointment_type_id && a.appointment_types ? effectivePriceCents(a.appointment_types.default_price_cents, a.appointment_type_id, a.practitioner_id ?? '', ovr) : 0

    return { appointment: a, view, payment, priceCents, overrides: ovr }
  }

  return { load }
}
