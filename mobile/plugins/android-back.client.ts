import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

// Android's back button (and back gesture). Capacitor's Android core has no
// handling of its own -- only @capacitor/app adds it -- so pressing back
// anywhere, an open visit or an Inbox thread included, closed the app.
// Now it goes back a screen, and from the first screen it sends the app to
// the background as Android apps do. Reception mode's guard
// (middleware/reception.global.ts) still holds: going back from the forms
// lands on the forms again.
export default defineNuxtPlugin(() => {
  if (Capacitor.getPlatform() !== 'android') return
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.minimizeApp()
  })
})
