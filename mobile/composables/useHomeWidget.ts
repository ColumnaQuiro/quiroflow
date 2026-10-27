import { Capacitor, registerPlugin } from '@capacitor/core'
import type { WidgetSnapshot } from '../../utils/homeWidget'

// Hands the home-screen widget its snapshot (utils/homeWidget.ts) through the
// app's own native plugin, "HomeWidget": on iOS it is kept in a keychain item
// the widget extension shares (ios/App/App/HomeWidgetPlugin.swift), on
// Android in SharedPreferences (HomeWidgetPlugin.java), and the widget is
// asked to redraw. Nothing on the web, and nothing on an app build from
// before the plugin existed -- the call fails quietly there.
//
// The widget also fetches its own snapshot while the app is closed
// (server/api/widget/home.get.ts; WidgetKit on iOS, WorkManager on Android). setRefresh hands it what it needs: where
// to ask, for which clinic, in which language and privacy mode, and a widget
// token (issue_home_widget_token) -- never the app's own session. Without a
// token it only updates the settings and says whether one is already there.
export interface WidgetRefresh {
  url: string
  accountId: string
  timeZone: string
  lang: 'es' | 'en'
  privacy: boolean
  token?: string
}
interface HomeWidgetPlugin {
  setSnapshot(options: { json: string }): Promise<void>
  setRefresh(options: WidgetRefresh): Promise<{ hasToken: boolean }>
  clear(): Promise<void>
}
const HomeWidget = registerPlugin<HomeWidgetPlugin>('HomeWidget')

export function useHomeWidget() {
  async function publish(snapshot: WidgetSnapshot) {
    if (!Capacitor.isNativePlatform()) return
    try {
      await HomeWidget.setSnapshot({ json: JSON.stringify(snapshot) })
    } catch {
      // An older app build without the plugin: no widget to feed.
    }
  }
  /**
   * Lets the widget refresh itself; `issue` is asked for a token only when
   * the widget has none.
   */
  async function keepFresh(refresh: Omit<WidgetRefresh, 'token'>, issue: () => Promise<string | null>) {
    if (!Capacitor.isNativePlatform()) return
    try {
      const { hasToken } = await HomeWidget.setRefresh(refresh)
      if (hasToken) return
      const token = await issue()
      if (token) await HomeWidget.setRefresh({ ...refresh, token })
    } catch {
      // An app build from before setRefresh: the widget waits for the app.
    }
  }
  /** On sign-out: the widget must not keep showing someone's day, nor fetch it. */
  async function clear() {
    if (!Capacitor.isNativePlatform()) return
    try {
      await HomeWidget.clear()
    } catch {
      // As above.
    }
  }
  return { publish, keepFresh, clear }
}
