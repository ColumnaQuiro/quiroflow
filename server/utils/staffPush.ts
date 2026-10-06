import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import type { BusinessHours } from '~/utils/businessHours'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, localDay, startOfLocalDate, nextDate } from '~/utils/clinicClock'
import { outsideHoursInZone } from '~/utils/staffQuietHours'
import { sendPushToUsers } from './pushNotifications'

// Push notifications for the clinic's team, each kind switchable per person
// in the app's Profile > Avisos (staff_push_preferences):
//
//   online_bookings  a patient booked online (notifyStaffOfOnlineBooking)
//   changes          a visit cancelled or moved -- by the patient (WhatsApp
//                    reply, the public API) or by a colleague (fire.post.ts)
//   inbox            a new Inbox message (notifyInboxTeamMembers)
//   check_in         reception checked their patient in
//   morning_summary  8:00, the day ahead (same-day-cron.post.ts)
//
// "Only your patients and your diary": a visit's push goes to its
// practitioner -- to the owners when it has none -- and never to whoever did
// the thing. With quiet_hours on, nothing but the morning summary arrives
// outside that person's working hours, read in the clinic's time zone.
type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

export type StaffPushKind = 'online_bookings' | 'changes' | 'inbox' | 'check_in' | 'morning_summary'

interface Preferences {
  online_bookings: boolean
  changes: boolean
  inbox: boolean
  check_in: boolean
  morning_summary: boolean
  quiet_hours: boolean
}
// The table's own defaults, for someone who has never opened Avisos.
const DEFAULTS: Preferences = { online_bookings: true, changes: true, inbox: true, check_in: false, morning_summary: true, quiet_hours: false }

export interface StaffRecipient {
  id: string
  user_id: string | null
  business_hours?: BusinessHours | null
}

/**
 * The user ids, of the given team members, that want a push of this kind
 * now. Reads preferences with the service role; a missing row is DEFAULTS.
 */
export async function wantingPush(
  service: Service,
  members: StaffRecipient[],
  kind: StaffPushKind,
  clinic: { timezone: string | null; business_hours: BusinessHours | null } | null,
  at = new Date(),
): Promise<string[]> {
  const withUser = members.filter((m) => m.user_id)
  if (withUser.length === 0) return []
  const { data } = await service
    .from('staff_push_preferences')
    .select('team_member_id, online_bookings, changes, inbox, check_in, morning_summary, quiet_hours')
    .in('team_member_id', withUser.map((m) => m.id))
  const byId = new Map(((data as unknown as (Preferences & { team_member_id: string })[] | null) ?? []).map((p) => [p.team_member_id, p]))
  const tz = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
  return withUser
    .filter((m) => {
      const p = byId.get(m.id) ?? DEFAULTS
      if (!p[kind]) return false
      if (kind !== 'morning_summary' && p.quiet_hours && outsideHoursInZone(at, tz, clinic?.business_hours, m.business_hours)) return false
      return true
    })
    .map((m) => m.user_id!)
}

function dayAndTime(iso: string, tz: string) {
  const d = new Date(iso)
  const day = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).replace(/\./g, '').replace(',', '')
  const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  return { day, time }
}

export type AppointmentPushEvent = 'booked_online' | 'cancelled' | 'rescheduled' | 'checked_in'
const KIND_OF: Record<AppointmentPushEvent, StaffPushKind> = { booked_online: 'online_bookings', cancelled: 'changes', rescheduled: 'changes', checked_in: 'check_in' }

/**
 * Tells a visit's practitioner (the owners, when it has none) what just
 * happened to it, unless they did it themselves. Best-effort: never throws.
 */
export async function pushAppointmentEvent(service: Service, appointmentId: string, event: AppointmentPushEvent, actorTeamMemberId: string | null = null) {
  try {
    const { data: appt } = await service
      .from('appointments')
      .select('id, account_id, practitioner_id, starts_at, patients(first_name, last_name), appointment_types(name), clinics(timezone, business_hours)')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt) return
    const a = appt as unknown as {
      account_id: string
      practitioner_id: string | null
      starts_at: string
      patients: { first_name: string; last_name: string | null } | null
      appointment_types: { name: string } | null
      clinics: { timezone: string | null; business_hours: BusinessHours | null } | null
    }
    let query = service.from('team_members').select('id, user_id, business_hours').eq('account_id', a.account_id).is('deleted_at', null)
    query = a.practitioner_id ? query.eq('id', a.practitioner_id) : query.eq('is_owner', true)
    const { data: members } = await query
    const recipients = ((members as StaffRecipient[] | null) ?? []).filter((m) => m.id !== actorTeamMemberId)
    const userIds = await wantingPush(service, recipients, KIND_OF[event], a.clinics)
    if (userIds.length === 0) return

    const tz = a.clinics?.timezone || DEFAULT_CLINIC_TIMEZONE
    const name = `${a.patients?.first_name ?? ''} ${a.patients?.last_name ?? ''}`.trim()
    const { day, time } = dayAndTime(a.starts_at, tz)
    const type = a.appointment_types?.name
    const message = {
      booked_online: { title: 'Nueva cita online', body: [name, type, `${day}, ${time}`].filter(Boolean).join(' · ') },
      cancelled: { title: 'Cita cancelada', body: `${name} · ${day}, ${time}` },
      rescheduled: { title: 'Cita movida', body: `${name} → ${day}, ${time}` },
      checked_in: { title: `Ha llegado ${name}`, body: [`Cita de las ${time}`, type].filter(Boolean).join(' · ') },
    }[event]
    await sendPushToUsers(service, userIds, { ...message, data: { type: 'appointment', appointmentId } })
  } catch (err) {
    console.error('[staff-push] appointment event failed', event, appointmentId, err)
  }
}

// The summary goes out in the first cron tick at or after 8:00 where each
// clinic is; the cron runs every 15 minutes, so the window is wide enough to
// always contain one tick and summary_sent_on stops a second.
const SUMMARY_HOUR = 8
const SUMMARY_WINDOW_MINUTES = 20

/** The 8:00 "your day" push, for every practitioner who wants it. Best-effort. */
export async function sendStaffMorningSummaries(service: Service, now = new Date()) {
  let sent = 0
  try {
    // Every clinic, a page at a time: PostgREST answers at most 1000 rows, and
    // a clinic past the first page would never get its summary.
    type ClinicRow = { id: string; account_id: string; timezone: string | null; business_hours: BusinessHours | null }
    const clinics: ClinicRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data: page } = await service.from('clinics').select('id, account_id, timezone, business_hours').is('archived_at', null).order('id').range(from, from + 999)
      clinics.push(...((page as ClinicRow[] | null) ?? []))
      if (!page || page.length < 1000) break
    }
    const due = clinics.filter((c) => {
      const m = localDay(now, c.timezone || DEFAULT_CLINIC_TIMEZONE).minutesSinceMidnight
      return m >= SUMMARY_HOUR * 60 && m < SUMMARY_HOUR * 60 + SUMMARY_WINDOW_MINUTES
    })
    for (const clinic of due) {
      const tz = clinic.timezone || DEFAULT_CLINIC_TIMEZONE
      const today = clinicDateOf(now, tz)
      const { data: members } = await service
        .from('team_members')
        .select('id, user_id, business_hours')
        .eq('account_id', clinic.account_id)
        .eq('is_practitioner', true)
        .is('deleted_at', null)
        .not('user_id', 'is', null)
      const wanting = new Set(await wantingPush(service, (members as StaffRecipient[] | null) ?? [], 'morning_summary', clinic, now))
      for (const m of ((members as StaffRecipient[] | null) ?? []).filter((x) => x.user_id && wanting.has(x.user_id))) {
        const { data: visits } = await service
          .from('appointments')
          .select('starts_at')
          .eq('clinic_id', clinic.id)
          .eq('practitioner_id', m.id)
          .eq('status', 'booked')
          .is('deleted_at', null)
          .gte('starts_at', startOfLocalDate(today, tz).toISOString())
          .lt('starts_at', startOfLocalDate(nextDate(today), tz).toISOString())
          .order('starts_at')
        if (!visits?.length) continue
        // Claimed before sending: a second tick in the window finds it taken.
        await service.from('staff_push_preferences').upsert({ team_member_id: m.id, account_id: clinic.account_id } as never, { onConflict: 'team_member_id', ignoreDuplicates: true })
        const { data: claimed } = await service
          .from('staff_push_preferences')
          .update({ summary_sent_on: today } as never)
          .eq('team_member_id', m.id)
          .or(`summary_sent_on.is.null,summary_sent_on.neq.${today}`)
          .select('team_member_id')
        if (!(claimed as unknown[] | null)?.length) continue
        const first = dayAndTime(visits[0].starts_at, tz).time
        const n = visits.length
        await sendPushToUsers(service, [m.user_id!], {
          title: 'Tu día',
          body: `Hoy tienes ${n} ${n === 1 ? 'cita' : 'citas'}, la primera a las ${first}.`,
          data: { type: 'my_day' },
        })
        sent++
      }
    }
  } catch (err) {
    console.error('[staff-push] morning summary failed', err)
  }
  return sent
}
