import { practitionerWindowsForDay } from '~/utils/businessHours'
import type { BusinessHours } from '~/utils/businessHours'
import { ApiError, badRequest, defineApiHandler } from '~/server/utils/publicApi'
import { assertBelongsToAccount } from '~/server/utils/publicApiHandlers'

// Free slots for booking. This is the endpoint an AI receptionist or a
// third-party booking widget calls before POST /appointments, and it applies
// the same rules the clinic's own booking page does:
//
//   * a practitioner's own weekly hours are authoritative and are NOT
//     narrowed by the clinic's (see utils/businessHours.ts for why -- a
//     stale clinic record used to silently clip real schedules);
//   * the clinic's hours are the fallback for a practitioner who has never
//     set their own;
//   * slots step by the appointment's own length, so what's offered here is
//     bookable as-is rather than needing the caller to round;
//   * existing appointments and availability blocks remove slots.
//
// Everything in and out is UTC ISO 8601. business_hours are wall-clock
// strings in the clinic's timezone, so they're converted using that timezone
// rather than the server's -- Netlify runs UTC, and treating "09:00" as
// 09:00Z would offer a Madrid clinic slots an hour or two off all year.

const MAX_RANGE_DAYS = 62
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

interface BusyInterval {
  start: number
  end: number
}

export default defineApiHandler({ scope: 'appointments:read' }, async ({ event, supabase, accountId }) => {
  const query = getQuery(event)

  const clinicId = requireUuidParam(query.clinic_id, 'clinic_id')
  const appointmentTypeId = requireUuidParam(query.appointment_type_id, 'appointment_type_id')
  const practitionerFilter = query.practitioner_id ? requireUuidParam(query.practitioner_id, 'practitioner_id') : undefined

  const from = requireDateParam(query.from, 'from')
  const to = requireDateParam(query.to, 'to')
  if (to < from) throw badRequest('"to" must be on or after "from".', 'to')
  const dayCount = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
  if (dayCount > MAX_RANGE_DAYS) {
    throw badRequest(`Range is ${dayCount} days; the maximum is ${MAX_RANGE_DAYS}. Request a shorter window.`, 'to')
  }

  const clinic = await assertBelongsToAccount(supabase, 'clinics', clinicId, accountId, 'clinic_id')
  const appointmentType = await assertBelongsToAccount(supabase, 'appointment_types', appointmentTypeId, accountId, 'appointment_type_id')
  const timezone = (clinic.timezone as string) || 'Europe/Madrid'

  // Practitioners considered. Unlike the public booking page this does not
  // require online_booking_enabled: an authenticated integration acts for
  // the clinic, so it can see practitioners the clinic doesn't publish to
  // patients. online_booking_enabled is returned per practitioner so a
  // caller building a patient-facing widget can filter on it.
  let practitionerQuery = supabase
    .from('team_members')
    .select('id, full_name, business_hours, online_booking_enabled')
    .eq('account_id', accountId)
    .eq('is_practitioner', true)
    .is('deleted_at', null)
  if (practitionerFilter) practitionerQuery = practitionerQuery.eq('id', practitionerFilter)

  const { data: practitioners, error: practitionerError } = await practitionerQuery
  if (practitionerError) throw new ApiError('server_error', practitionerError.message)
  if (practitionerFilter && !practitioners?.length) {
    throw badRequest(`No active practitioner in this account with id "${practitionerFilter}".`, 'practitioner_id')
  }

  const rangeStart = new Date(`${from}T00:00:00Z`)
  // Wide enough to cover the whole last day in any timezone, so a slot late
  // on the final day isn't missed because the window closed at 00:00 UTC.
  const rangeEnd = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86400000)

  const [{ data: appointments }, { data: blocks }, { data: overrides }] = await Promise.all([
    supabase
      .from('appointments')
      .select('practitioner_id, starts_at, ends_at')
      .eq('account_id', accountId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .lt('starts_at', rangeEnd.toISOString())
      .gt('ends_at', rangeStart.toISOString()),
    supabase
      .from('availability_blocks')
      .select('practitioner_id, starts_at, ends_at')
      .eq('account_id', accountId)
      .eq('clinic_id', clinicId)
      .lt('starts_at', rangeEnd.toISOString())
      .gt('ends_at', rangeStart.toISOString()),
    supabase
      .from('appointment_type_overrides')
      .select('team_member_id, duration_minutes')
      .eq('account_id', accountId)
      .eq('appointment_type_id', appointmentTypeId),
  ])

  const busyByPractitioner = new Map<string, BusyInterval[]>()
  for (const row of appointments ?? []) {
    if (!row.practitioner_id) continue
    push(busyByPractitioner, row.practitioner_id, row)
  }
  // A block with no practitioner_id closes the clinic for everyone (a bank
  // holiday, say), so it applies to every practitioner rather than none.
  const clinicWideBlocks: BusyInterval[] = []
  for (const row of blocks ?? []) {
    if (row.practitioner_id) push(busyByPractitioner, row.practitioner_id, row)
    else clinicWideBlocks.push({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) })
  }

  const overrideDuration = new Map<string, number>()
  for (const row of overrides ?? []) {
    if (row.duration_minutes) overrideDuration.set(row.team_member_id, row.duration_minutes)
  }

  const clinicHours = clinic.business_hours as BusinessHours | null
  const now = Date.now()
  const days: { date: string; slots: { starts_at: string; ends_at: string; practitioner_id: string }[] }[] = []

  for (let offset = 0; offset < dayCount; offset++) {
    const dayMs = Date.parse(`${from}T00:00:00Z`) + offset * 86400000
    const date = new Date(dayMs).toISOString().slice(0, 10)
    // Weekday of the calendar date itself -- computed in UTC on a UTC
    // midnight, so it's the plain "what day is 2026-03-14" answer and not
    // subject to the server's own offset.
    const dayKey = DAY_KEYS[new Date(dayMs).getUTCDay()]
    const clinicWindows = clinicHours?.[dayKey] ?? []

    const slots: { starts_at: string; ends_at: string; practitioner_id: string }[] = []

    for (const practitioner of practitioners ?? []) {
      const duration = overrideDuration.get(practitioner.id) ?? (appointmentType.duration_minutes as number)
      const windows = practitionerWindowsForDay(clinicWindows, practitioner.business_hours as BusinessHours | null, dayKey)
      const busy = [...(busyByPractitioner.get(practitioner.id) ?? []), ...clinicWideBlocks]

      for (const [openAt, closeAt] of windows) {
        const windowStart = wallClockToUtc(date, openAt, timezone)
        const windowEnd = wallClockToUtc(date, closeAt, timezone)

        for (let cursor = windowStart; cursor + duration * 60000 <= windowEnd; cursor += duration * 60000) {
          const slotEnd = cursor + duration * 60000
          if (cursor <= now) continue
          if (busy.some((b) => b.start < slotEnd && b.end > cursor)) continue
          slots.push({
            starts_at: new Date(cursor).toISOString(),
            ends_at: new Date(slotEnd).toISOString(),
            practitioner_id: practitioner.id,
          })
        }
      }
    }

    slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    days.push({ date, slots })
  }

  return {
    data: {
      clinic_id: clinicId,
      timezone,
      appointment_type_id: appointmentTypeId,
      practitioners: (practitioners ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        online_booking_enabled: p.online_booking_enabled,
      })),
      days,
    },
  }
})

function push(map: Map<string, BusyInterval[]>, key: string, row: { starts_at: string; ends_at: string }) {
  const list = map.get(key) ?? []
  list.push({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) })
  map.set(key, list)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireUuidParam(value: unknown, field: string): string {
  const raw = typeof value === 'string' ? value : ''
  if (!UUID_RE.test(raw)) throw badRequest(`"${field}" is required and must be a UUID.`, field)
  return raw
}

function requireDateParam(value: unknown, field: string): string {
  const raw = typeof value === 'string' ? value : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw badRequest(`"${field}" is required and must be a date in YYYY-MM-DD form.`, field)
  }
  return raw
}

// Turns "2026-03-14" + "09:00" in a named timezone into the UTC instant it
// refers to.
//
// Two passes because the offset depends on the instant we're solving for:
// the first guess uses the offset at the naive-UTC reading of the wall clock,
// which is wrong for the couple of hours a year that straddle a DST switch.
// Re-reading the offset at the corrected instant settles it.
function wallClockToUtc(date: string, hhmm: string, timeZone: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  const naive = Date.parse(`${date}T00:00:00Z`) + (hours * 60 + minutes) * 60000

  let instant = naive - offsetMinutes(naive, timeZone) * 60000
  const settled = naive - offsetMinutes(instant, timeZone) * 60000
  if (settled !== instant) instant = settled
  return instant
}

// Minutes that `timeZone` is ahead of UTC at the given instant.
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Intl renders midnight as hour 24 in some ICU versions; normalise it.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - instant) / 60000)
}
