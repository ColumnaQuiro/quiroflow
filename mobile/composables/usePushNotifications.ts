import { FirebaseMessaging } from '@capacitor-firebase/messaging'
import { Capacitor } from '@capacitor/core'

// Requests permission and registers this device for push -- called once the
// practitioner Inbox is open, since v1 only sends pushes for new WhatsApp
// messages. No-ops on web (native-only API) and swallows errors so a device
// that can't register (permission denied, no Firebase config yet on
// Android, etc.) doesn't break the rest of the app.
//
// Uses @capacitor-firebase/messaging rather than the official
// @capacitor/push-notifications: on iOS that plugin only ever hands back the
// raw APNs device token, not an FCM registration token, and the server sends
// via FCM's v1 API (server/utils/pushNotifications.ts), which needs a real
// FCM token. This plugin does the APNs<->FCM exchange natively via the
// Firebase SDK on both platforms, so getToken() always returns something the
// server can actually send to.
//
// Module-level, not per-call-site: only ever one real device token per app
// instance, and sign-out (from wherever it's triggered) needs it to
// unregister.
let lastToken: string | null = null

// The conversation a notification tap wants opened, read by
// PractitionerInbox.vue (via mobile/pages/inbox.vue) once mounted -- a
// module-level ref rather than a route query param because a tap can arrive
// while the Inbox tab is already open (no navigation happens, so there's no
// new route to carry it), and because the listener fires from outside any
// component's setup where injecting page state isn't available.
export const pendingConversationKey = ref<string | null>(null)

// Listeners are attached once per app run, and before anything that can
// fail: register() runs every time a layout mounts (staff and patient), and
// attaching on each run stacked a copy per sign-in, so one tap navigated N
// times; attaching only after the token POST meant an offline launch left
// taps doing nothing for the whole session.
let listenersAttached = false

// Where a tapped notification goes. Staff pushes (server/utils/staffPush.ts)
// carry { type: 'appointment', appointmentId } or { type: 'my_day' }; Inbox
// pushes { type, key } with the conversation key. A patient's own pushes
// (sendPushToPatients) carry appointment_<purpose> with the appointment id,
// patient_app_message with no key (the clinic replied), or
// clinic_announcement -- and open their side of the app.
function routeTap(data: Record<string, string> | undefined) {
  const type = data?.type ?? ''
  if (type === 'appointment' && data?.appointmentId) return navigateTo(`/calendar/${data.appointmentId}`)
  if (type === 'my_day') return navigateTo('/my-day')
  if (type.startsWith('appointment_')) return navigateTo('/visits')
  if (type === 'patient_app_message' && !data?.key) return navigateTo('/messages')
  if (type === 'clinic_announcement') return navigateTo('/')
  if (!data?.key) return
  pendingConversationKey.value = data.key
  return navigateTo('/inbox')
}

export function usePushNotifications() {
  const authedFetch = useAuthedFetch()

  async function send(token: string) {
    await authedFetch('/api/mobile/register-push-token', { method: 'POST', body: { token, platform: Capacitor.getPlatform() } })
  }

  async function register() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const permission = await FirebaseMessaging.requestPermissions()
      if (permission.receive !== 'granted') return

      if (!listenersAttached) {
        listenersAttached = true
        FirebaseMessaging.addListener('tokenReceived', async (event) => {
          lastToken = event.token
          try {
            await send(event.token)
          } catch {
            // Best-effort -- the app still works without push.
          }
        })
        FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
          routeTap(event.notification.data as Record<string, string> | undefined)
        })
      }

      const { token } = await FirebaseMessaging.getToken()
      lastToken = token
      await send(token)
    } catch {
      // Best-effort -- the app still works without push.
    }
  }

  // Every sign-out calls this, so the next person on the phone does not get
  // the previous one's pushes. The token is asked of the plugin when this
  // run never registered (a patient's sign-out from Account, say).
  async function unregister() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const token = lastToken ?? (await FirebaseMessaging.getToken()).token
      if (!token) return
      await authedFetch('/api/mobile/unregister-push-token', { method: 'POST', body: { token } })
      lastToken = null
    } catch {
      // Best-effort -- signing out should never get stuck on this.
    }
  }

  return { register, unregister }
}
