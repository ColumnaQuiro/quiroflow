import type { PanelActivityRow, PanelAppointment } from '~/components/calendar/AppointmentPanel.vue'
import type { BlockView } from '~/components/calendar/AppointmentBlock.vue'
import type { AppointmentTypeOverride } from '~/utils/appointmentOverrides'
import { effectivePriceCents } from '~/utils/appointmentOverrides'
import { appointmentStage, needsNextBookingFlag, pendingFormsFlag } from '~/utils/appointmentStage'
import { shortPatientName } from '~/utils/appointmentBlock'
import { bonoForVisit, type VisitPayment } from '~/utils/visitPayment'
import { formatTime } from '~/utils/billing'
import { visitPaymentsFromRows, type VisitPaymentRows } from '~/composables/useVisitPayments'

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
//
// Two requests, side by side (three on the first panel of a session, which
// also reads the clinic's reminder setting): the row, and appointment_panel -- everything
// else, which needs only the id. It was the row and then seven more (the
// payments, the balance, the packs, the moves, the next visit, the
// overrides), with the panel's audit trail as a ninth once it mounted.

export interface AppointmentPanelInputs {
  appointment: PanelAppointment & { appointment_types: { name: string; color: string; default_price_cents: number } | null }
  view: BlockView
  payment: VisitPayment
  priceCents: number
  overrides: AppointmentTypeOverride[]
  /** The visit's audit trail, so the panel need not ask for it again (its `activity` prop). */
  activity: PanelActivityRow[]
}

/** What the appointment_panel function returns: raw rows, read here as they always were. */
interface AppointmentPanelRows {
  visit_payments: VisitPaymentRows
  balance: { outstanding_cents: number | null } | null
  package_purchases: { package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean }[]
  reschedule_count: number
  has_later_visit: boolean
  overrides: AppointmentTypeOverride[]
  activity: PanelActivityRow[]
}

const SELECT =
  'id, patient_id, room_id, practitioner_id, appointment_type_id, starts_at, ends_at, status, checked_in_at, flow_with_practitioner_at, flow_checkout_at, rescheduled, confirmation_status, confirmation_sent_at, reminder_sent_at, reminder_claimed_at, same_day_info_sent_at, created_at, deleted_at, note, source, patients(first_name, last_name, sticky_note, pending_forms, red_flags, tags), appointment_types(name, color, default_price_cents), team_members(full_name, color)'

export function useAppointmentPanelLoader() {
  const supabase = useSupabaseClient()
  // Same setting the calendar reads, so a visit is "Sin confirmar" or
  // "Confirmada" alike in both (utils/appointmentStage).
  const reminders = useReminderSettings()

  async function load(appointmentId: string): Promise<AppointmentPanelInputs | null> {
    const [{ data: row, error }, details, reminderSettings] = await Promise.all([
      supabase.from('appointments').select(SELECT).eq('id', appointmentId).maybeSingle(),
      supabase.rpc('appointment_panel' as never, { p_appointment_id: appointmentId } as never),
      // Cached after the first visit opened; a failure draws it as before.
      reminders.ensure().catch(() => null),
    ])
    // Thrown, not "no such visit": the panel's caller shows nothing for null.
    if (error) throw error
    if (!row) return null
    if (details.error) throw details.error
    const a = row as unknown as AppointmentPanelInputs['appointment']
    const rows = (details.data ?? {}) as unknown as Partial<AppointmentPanelRows>

    const payments = visitPaymentsFromRows([a.id], rows.visit_payments)
    const balance = rows.balance ?? null
    const packages = rows.package_purchases ?? []
    const moved = rows.reschedule_count ?? 0
    const ovr = rows.overrides ?? []

    const payment: VisitPayment = payments[a.id] ?? { kind: 'none' }
    // Same rule as the calendar: the newest pack that is neither closed nor used up.
    const active = packages.find((p) => !p.is_closed && p.sessions_used < p.sessions_total) ?? null
    const stage = appointmentStage(a, reminderSettings)

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
      pendingForms: pendingFormsFlag(stage, a.starts_at, a.patients?.pending_forms),
      redFlags: a.patients?.red_flags?.trim() || null,
      tags: a.patients?.tags ?? [],
      movedCount: moved,
      // The calendar's rule for "has a next visit", answered by the function.
      noNext: needsNextBookingFlag(stage, a.starts_at, rows.has_later_visit ?? false),
    }
    const priceCents =
      a.appointment_type_id && a.appointment_types ? effectivePriceCents(a.appointment_types.default_price_cents, a.appointment_type_id, a.practitioner_id ?? '', ovr) : 0

    return { appointment: a, view, payment, priceCents, overrides: ovr, activity: rows.activity ?? [] }
  }

  return { load }
}
