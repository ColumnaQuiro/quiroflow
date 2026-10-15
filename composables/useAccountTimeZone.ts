import { DEFAULT_CLINIC_TIMEZONE } from '../utils/clinicClock'

// The account's own clock for things that belong to the account rather than
// to one clinic -- the registro de jornada's days: its first live clinic's
// time zone, the same one account_local_date() reads in the database, so a
// day the server stamped is the day the screen shows.
export function useAccountTimeZone() {
  const supabase = useSupabaseClient()
  const timeZone = useState<string>('account-time-zone', () => DEFAULT_CLINIC_TIMEZONE)
  const ready = useState<boolean>('account-time-zone-ready', () => false)
  onMounted(async () => {
    if (ready.value) return
    const { data } = await supabase.from('clinics').select('timezone').is('archived_at', null).not('timezone', 'is', null).order('created_at').limit(1).maybeSingle()
    if ((data as { timezone: string | null } | null)?.timezone) timeZone.value = (data as { timezone: string }).timezone
    ready.value = true
  })
  return { timeZone, ready }
}
