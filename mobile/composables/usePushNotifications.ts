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

export function usePushNotifications() {
  const authedFetch = useAuthedFetch()

  async function register() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const permission = await FirebaseMessaging.requestPermissions()
      if (permission.receive !== 'granted') return

      const { token } = await FirebaseMessaging.getToken()
      lastToken = token
      await authedFetch('/api/mobile/register-push-token', {
        method: 'POST',
        body: { token, platform: Capacitor.getPlatform() },
      })

      FirebaseMessaging.addListener('tokenReceived', async (event) => {
        lastToken = event.token
        try {
          await authedFetch('/api/mobile/register-push-token', {
            method: 'POST',
            body: { token: event.token, platform: Capacitor.getPlatform() },
          })
        } catch {
          // Best-effort -- the Inbox still works without push.
        }
      })

      // Tapping the notification (app backgrounded, or launched fresh by
      // the tap) -- notifyInboxTeamMembers (server/utils/pushNotifications.ts)
      // already sends { type, key } in the data payload for exactly this,
      // it just had nothing on the client reading it until now. Routes to
      // the Inbox tab and hands off the target conversation key; navigating
      // there when already on it is a harmless no-op.
      FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
        const data = event.notification.data as Record<string, string> | undefined
        if (!data?.key) return
        pendingConversationKey.value = data.key
        navigateTo('/inbox')
      })
    } catch {
      // Best-effort -- the Inbox still works without push.
    }
  }

  async function unregister() {
    if (!lastToken) return
    try {
      await authedFetch('/api/mobile/unregister-push-token', { method: 'POST', body: { token: lastToken } })
    } catch {
      // Best-effort -- signing out should never get stuck on this.
    }
  }

  return { register, unregister }
}
