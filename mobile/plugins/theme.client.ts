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

  // The status bar sits on the back plane (app.vue paints the strip behind it
  // in the plane's colour), which is dark in both themes, so its text is
  // white -- except on the sign-in screens, which are the theme's own
  // surface edge to edge (html.auth-screen, components/onboarding/Layout.vue).
  const authScreen = ref(document.documentElement.classList.contains('auth-screen'))
  new MutationObserver(() => {
    authScreen.value = document.documentElement.classList.contains('auth-screen')
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  watch(
    [resolved, authScreen],
    ([theme, auth]) => {
      const lightText = theme === 'dark' || !auth
      StatusBar.setStyle({ style: lightText ? Style.Dark : Style.Light }).catch(() => {})
      if (Capacitor.getPlatform() === 'ios') Keyboard.setStyle({ style: theme === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(() => {})
    },
    { immediate: true },
  )
})
