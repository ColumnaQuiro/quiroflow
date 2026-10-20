import { Capacitor } from '@capacitor/core'
import { widgetSnapshotFromRpc, type HomeWidgetRpc } from '../../utils/homeWidget'

// Keeps a staff member's home-screen widget current: asks get_home_widget
// (20261020142327_home_widget.sql) what this person's widget shows -- an
// owner the clinic's month, a practitioner their day, the front desk the
// clinic's day -- and hands the snapshot to the native widget.
//
// The widget never talks to the server, so it is only as fresh as the last
// call here. That used to be My Day's own load and nothing else, so someone
// who lived in the calendar saw a widget from the morning. It is now called
// when the app opens or comes back (layouts/practitioner.vue), when My Day
// loads, and after taking money or checking someone in.
//
// Module-level throttle: the layout, My Day and an action can all ask within
// the same second; once a minute is plenty unless something just changed.
let lastRun = 0
let running: Promise<void> | null = null

export function useStaffHomeWidget() {
  const supabase = useSupabaseClient()
  const { context } = usePractitionerContext()
  const { preference } = useLang()
  const { privacy } = usePrivacyMode()
  const { publish, clear } = useHomeWidget()

  async function run() {
    const ctx = context.value
    if (!ctx) return
    const { data, error } = await supabase.rpc('get_home_widget' as never, { p_account_id: ctx.accountId, p_time_zone: ctx.timeZone } as never)
    // A failed call (offline, a pending second factor) keeps what the widget
    // shows, with its age, rather than replacing it with nothing.
    if (error || !data) return
    const snapshot = widgetSnapshotFromRpc(data as unknown as HomeWidgetRpc, { lang: preference.value === 'es' ? 'es' : 'en', privacy: privacy.value })
    if (snapshot) await publish(snapshot)
    else await clear()
  }

  /** `force` after something the widget shows has changed (money taken, a check-in). */
  async function refresh({ force = false } = {}) {
    if (!Capacitor.isNativePlatform()) return
    if (running) return running
    if (!force && Date.now() - lastRun < 60_000) return
    lastRun = Date.now()
    running = run().finally(() => {
      running = null
    })
    return running
  }

  return { refresh }
}
