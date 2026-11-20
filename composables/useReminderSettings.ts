import type { ReminderSettings } from '~/utils/appointmentStage'
import { clampReminderDays } from '~/utils/appointmentReminderDue'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'

// The clinic's appointment reminder (Settings -> Messages), for the screens
// that draw a visit's stage: whether a staff booking nobody has asked about
// yet is "Sin confirmar" (a reminder is coming) or "Confirmada" (none is)
// depends on it -- see utils/appointmentStage.
//
// Read once per account per session and kept in useState, not per range:
// it changes on the settings page, not while someone works the calendar.
// null until it has loaded, or when the read fails, which draws every visit
// the way it was drawn before this setting was consulted.
export function useReminderSettings() {
  const store = useAccountStore()
  const supabase = useSupabaseClient()
  const cache = useState<Record<string, ReminderSettings>>('reminder-settings', () => ({}))

  const settings = computed<ReminderSettings | null>(() => (store.accountId ? (cache.value[store.accountId] ?? null) : null))

  async function ensure(): Promise<ReminderSettings | null> {
    const accountId = store.accountId
    if (!accountId) return null
    if (cache.value[accountId]) return cache.value[accountId]
    // The 10:00 the reminders go out at is the clinic's; the account's first
    // live clinic stands for all of them here, as useAccountTimeZone does --
    // it only moves the boundary for a clinic in another zone by the
    // difference between the two.
    const [{ data, error }, { data: clinic }] = await Promise.all([
      supabase.from('accounts').select('appointment_reminder_enabled, appointment_reminder_days_before').eq('id', accountId).maybeSingle(),
      supabase.from('clinics').select('timezone').eq('account_id', accountId).is('archived_at', null).not('timezone', 'is', null).order('created_at').limit(1).maybeSingle(),
    ])
    if (error || !data) return null
    const row = data as { appointment_reminder_enabled: boolean | null; appointment_reminder_days_before: number | null }
    const loaded: ReminderSettings = {
      // The column's default, as settings/messages.vue reads it.
      enabled: row.appointment_reminder_enabled ?? true,
      daysBefore: clampReminderDays(row.appointment_reminder_days_before),
      timeZone: (clinic as { timezone: string | null } | null)?.timezone || DEFAULT_CLINIC_TIMEZONE,
    }
    cache.value = { ...cache.value, [accountId]: loaded }
    return loaded
  }

  return { settings, ensure }
}
