// Dark mode: the web's own theme (composables/useTheme.ts -- the
// [data-theme] palette in assets/css/theme.css, "system" by default, the
// choice kept on this device), applied before the first paint so the app
// never flashes the wrong one.
//
// The native chrome follows the theme in use, not the phone's: someone who
// picks "Dark" on a phone in light mode would otherwise get dark status-bar
// text on a dark page (iOS draws it from the system appearance), and a light
// keyboard under a dark screen.
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard'

export default defineNuxtPlugin(() => {
  const { initFromStorage, resolved } = useTheme()
  initFromStorage()
  if (!Capacitor.isNativePlatform()) return
  watch(
    resolved,
    (theme) => {
      StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
      if (Capacitor.getPlatform() === 'ios') Keyboard.setStyle({ style: theme === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(() => {})
    },
    { immediate: true },
  )
})
