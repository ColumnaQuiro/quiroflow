import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'

// Requests permission and registers this device for push -- called once the
// practitioner Inbox is open, since v1 only sends pushes for new WhatsApp
// messages. No-ops on web (native-only API) and swallows errors so a device
// that can't register (permission denied, no Firebase config yet on
// Android, etc.) doesn't break the rest of the app.
export function usePushNotifications() {
  const authedFetch = useAuthedFetch()

  async function register() {
    if (!Capacitor.isNativePlatform()) return
    try {
      const permission = await PushNotifications.requestPermissions()
      if (permission.receive !== 'granted') return

      await PushNotifications.register()

      PushNotifications.addListener('registration', async (token) => {
        try {
          await authedFetch('/api/mobile/register-push-token', {
            method: 'POST',
            body: { token: token.value, platform: Capacitor.getPlatform() },
          })
        } catch {
          // Best-effort -- the Inbox still works without push.
        }
      })
    } catch {
      // Best-effort -- the Inbox still works without push.
    }
  }

  return { register }
}
