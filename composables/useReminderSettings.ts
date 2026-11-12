import type { ReminderSettings } from '~/utils/appointmentStage'
import { DEFAULT_REMINDER_HOURS } from '~/utils/appointmentReminderDue'

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
    const { data, error } = await supabase.from('accounts').select('appointment_reminder_enabled, appointment_reminder_hours_before').eq('id', accountId).maybeSingle()
    if (error || !data) return null
    const row = data as { appointment_reminder_enabled: boolean | null; appointment_reminder_hours_before: number | null }
    const loaded: ReminderSettings = {
      // The column's default, as settings/messages.vue reads it.
      enabled: row.appointment_reminder_enabled ?? true,
      hoursBefore: row.appointment_reminder_hours_before ?? DEFAULT_REMINDER_HOURS,
    }
    cache.value = { ...cache.value, [accountId]: loaded }
    return loaded
  }

  return { settings, ensure }
}
