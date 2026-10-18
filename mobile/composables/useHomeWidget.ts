import { Capacitor, registerPlugin } from '@capacitor/core'
import type { WidgetSnapshot } from '../../utils/homeWidget'

// Hands the home-screen widget its snapshot (utils/homeWidget.ts) through the
// app's own native plugin, "HomeWidget": on iOS it is kept in a keychain item
// the widget extension shares (ios/App/App/HomeWidgetPlugin.swift), on
// Android in SharedPreferences (HomeWidgetPlugin.java), and the widget is
// asked to redraw. Nothing on the web, and nothing on an app build from
// before the plugin existed -- the call fails quietly there.
interface HomeWidgetPlugin {
  setSnapshot(options: { json: string }): Promise<void>
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
  /** On sign-out: the widget must not keep showing someone's day. */
  async function clear() {
    if (!Capacitor.isNativePlatform()) return
    try {
      await HomeWidget.clear()
    } catch {
      // As above.
    }
  }
  return { publish, clear }
}
