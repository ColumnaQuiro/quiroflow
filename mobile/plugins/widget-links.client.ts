import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { widgetLinkPath } from '../../utils/homeWidget'

// A tap on the home-screen widget opens the app on a quiroflow://widget/...
// link (utils/homeWidget.ts writes them; CFBundleURLTypes in Info.plist and
// the intent filter in AndroidManifest.xml route the scheme here): the
// owner's figures to Números or the clinic's calendar, a visit to that visit.
// widgetLinkPath accepts only those screens. Signed out, it does nothing.
//
// The calendar is kept alive between tabs, so a second tap on the same link
// would change nothing it watches: `w` is new every time.
export default defineNuxtPlugin(() => {
  if (!Capacitor.isNativePlatform()) return
  const supabase = useSupabaseClient()

  // A cold start can deliver the same link twice (getLaunchUrl and appUrlOpen).
  let last = { url: '', at: 0 }
  async function open(url: string | undefined) {
    const path = widgetLinkPath(url)
    if (!path) return
    if (url === last.url && Date.now() - last.at < 3000) return
    last = { url: url!, at: Date.now() }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await navigateTo(`${path}${path.includes('?') ? '&' : '?'}w=${Date.now()}`)
  }

  App.addListener('appUrlOpen', ({ url }) => {
    open(url)
  })
  App.getLaunchUrl().then((launch) => open(launch?.url))
})
