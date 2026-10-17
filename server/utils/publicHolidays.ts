import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE, nextDate, startOfLocalDate } from '~/utils/clinicClock'
import { holidaysFor, HOLIDAYS_KNOWN_THROUGH } from '~/utils/spanishHolidays'

// Closing a clinic on the official holidays of its comunidad
// (20261017165328_public_holidays.sql): each one becomes the whole-clinic
// availability block that "Cierres y festivos" adds by hand, tagged with the
// holiday's date. Called when an owner turns it on in Settings, and by the
// daily cron for the years a later deploy brings.

type Client = SupabaseClient<Database>
export interface HolidayClinic {
  id: string
  account_id: string
  timezone: string | null
  holiday_region: string | null
  holidays_loaded_through: string | null
}
export interface ClosedHoliday {
  date: string
  name: string
  /** Visits already booked that day: closing hides the free slots but moves nobody. */
  booked: number
}

/**
 * Closes the region's known holidays from today (or from where the last run
 * stopped, if later) and moves the marker to the end of what is known. A day
 * the clinic already has closed all day -- by hand, or as this holiday -- is
 * left as it is.
 */
export async function closePublicHolidays(supabase: Client, clinic: HolidayClinic, now = new Date()): Promise<ClosedHoliday[]> {
  if (!clinic.holiday_region) return []
  const tz = clinic.timezone || DEFAULT_CLINIC_TIMEZONE
  const today = clinicDateOf(now, tz)
  const from = clinic.holidays_loaded_through && clinic.holidays_loaded_through >= today ? nextDate(clinic.holidays_loaded_through) : today
  const holidays = holidaysFor(clinic.holiday_region, from, HOLIDAYS_KNOWN_THROUGH)

  const added: ClosedHoliday[] = []
  if (holidays.length) {
    const first = startOfLocalDate(holidays[0]!.date, tz)
    const last = startOfLocalDate(nextDate(holidays[holidays.length - 1]!.date), tz)
    const { data: existing, error } = await supabase
      .from('availability_blocks')
      .select('starts_at, ends_at, public_holiday')
      .eq('clinic_id', clinic.id)
      .is('practitioner_id', null)
      .is('room_id', null)
      .lt('starts_at', last.toISOString())
      .gt('ends_at', first.toISOString())
    if (error) throw new Error(error.message)
    const closedAllDay = (start: Date, end: Date, date: string) =>
      (existing ?? []).some((b) => b.public_holiday === date || (Date.parse(b.starts_at) <= start.getTime() && Date.parse(b.ends_at) >= end.getTime()))

    const rows = holidays
      .map((h) => ({ h, start: startOfLocalDate(h.date, tz), end: startOfLocalDate(nextDate(h.date), tz) }))
      .filter(({ h, start, end }) => !closedAllDay(start, end, h.date))
    // One block a day, should the table ever list two holidays for one region on one date.
    const byDate = new Map(rows.map((r) => [r.h.date, r]))
    if (byDate.size) {
      const { error: insertError } = await supabase.from('availability_blocks').insert(
        [...byDate.values()].map(({ h, start, end }) => ({
          account_id: clinic.account_id,
          clinic_id: clinic.id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          note: `Festivo: ${h.name}`,
          public_holiday: h.date,
        })),
      )
      if (insertError) throw new Error(insertError.message)

      const { data: visits } = await supabase
        .from('appointments')
        .select('starts_at')
        .eq('clinic_id', clinic.id)
        .is('deleted_at', null)
        .not('status', 'in', '(cancelled,no_show)')
        .gte('starts_at', first.toISOString())
        .lt('starts_at', last.toISOString())
      const bookedOn = new Map<string, number>()
      for (const v of visits ?? []) {
        const day = clinicDateOf(new Date(v.starts_at), tz)
        bookedOn.set(day, (bookedOn.get(day) ?? 0) + 1)
      }
      for (const { h } of byDate.values()) added.push({ date: h.date, name: h.name, booked: bookedOn.get(h.date) ?? 0 })
    }
  }

  const { error: markError } = await supabase.from('clinics').update({ holidays_loaded_through: HOLIDAYS_KNOWN_THROUGH }).eq('id', clinic.id)
  if (markError) throw new Error(markError.message)
  return added
}

/** Takes the official holidays still to come off the clinic's calendar (turned off, or a new region). */
export async function reopenPublicHolidays(supabase: Client, clinic: Pick<HolidayClinic, 'id' | 'timezone'>, now = new Date()) {
  const today = clinicDateOf(now, clinic.timezone || DEFAULT_CLINIC_TIMEZONE)
  const { error } = await supabase.from('availability_blocks').delete().eq('clinic_id', clinic.id).gte('public_holiday', today)
  if (error) throw new Error(error.message)
}

/**
 * The daily cron's part: clinics with automatic holidays whose marker is
 * behind what this deploy knows -- i.e. a new year has just shipped.
 */
export async function closeNewPublicHolidays(supabase: Client, now = new Date()) {
  const { data: clinics } = await supabase
    .from('clinics')
    .select('id, account_id, timezone, holiday_region, holidays_loaded_through')
    .eq('holidays_auto', true)
    .not('holiday_region', 'is', null)
    .is('archived_at', null)
    .or(`holidays_loaded_through.is.null,holidays_loaded_through.lt.${HOLIDAYS_KNOWN_THROUGH}`)
  for (const clinic of clinics ?? []) {
    try {
      await closePublicHolidays(supabase, clinic, now)
    } catch (e) {
      console.error('[public-holidays] clinic', clinic.id, e)
    }
  }
}
