import { Capacitor } from '@capacitor/core'
import { widgetSnapshotFromRpc, type HomeWidgetRpc } from '../../utils/homeWidget'

// Keeps a staff member's home-screen widget current: asks get_home_widget
// (20261020142327_home_widget.sql) what this person's widget shows -- an
// owner the clinic's month, a practitioner their day, the front desk the
// clinic's day -- and hands the snapshot to the native widget.
//
// This runs when the app opens or comes back (layouts/practitioner.vue),
// when My Day loads, and after taking money or checking someone in. Between
// those, the widget fetches the same snapshot itself, every quarter of an hour
// or so (server/api/widget/home.get.ts): each run here also hands it the
// clinic, the language, privacy mode and, once per session, a widget token.
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
  const { publish, keepFresh, clear } = useHomeWidget()
  const apiBase = useRuntimeConfig().public.apiBase as string

  async function run() {
    const ctx = context.value
    if (!ctx) return
    const { data, error } = await supabase.rpc('get_home_widget' as never, { p_account_id: ctx.accountId, p_time_zone: ctx.timeZone } as never)
    // A failed call (offline, a pending second factor) keeps what the widget
    // shows, with its age, rather than replacing it with nothing.
    if (error || !data) return
    const lang = preference.value === 'es' ? 'es' : 'en'
    const snapshot = widgetSnapshotFromRpc(data as unknown as HomeWidgetRpc, { lang, privacy: privacy.value })
    if (!snapshot) return clear()
    await publish(snapshot)
    await keepFresh({ url: `${apiBase}/api/widget/home`, accountId: ctx.accountId, timeZone: ctx.timeZone, lang, privacy: privacy.value }, async () => {
      const { data: token } = await supabase.rpc('issue_home_widget_token' as never)
      return typeof token === 'string' ? token : null
    })
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
