// Browser push for the Inbox, mirroring mobile/composables/usePushNotifications.ts:
// requests permission, registers an FCM token via the Firebase Web SDK, and
// sends it to the same /api/mobile/register-push-token endpoint (platform:
// 'web' instead of 'ios'/'android') so server/utils/pushNotifications.ts's
// existing send-to-every-registered-device logic just works, no server
// changes needed. No-ops quietly if the browser doesn't support the
// Notification/Service Worker APIs (e.g. some in-app browsers) or the user
// declines the permission prompt -- same "best-effort" convention as mobile.
export function useWebPush() {
  const config = useRuntimeConfig()

  const supported = computed(() => import.meta.client && 'Notification' in window && 'serviceWorker' in navigator)
  const permission = ref<NotificationPermission>(supported.value ? Notification.permission : 'default')

  async function register() {
    if (!supported.value || permission.value === 'denied') return
    try {
      const result = await Notification.requestPermission()
      permission.value = result
      if (result !== 'granted') return

      const [{ initializeApp }, { getMessaging, getToken, onMessage }] = await Promise.all([import('firebase/app'), import('firebase/messaging')])
      const app = initializeApp(config.public.firebaseWebConfig as Record<string, string>)
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      const messaging = getMessaging(app)
      const token = await getToken(messaging, { vapidKey: config.public.firebaseVapidKey as string, serviceWorkerRegistration: registration })
      if (!token) return

      await useStaffFetch('/api/mobile/register-push-token', { method: 'POST', body: { token, platform: 'web' } })

      // FCM's onMessage only fires for the foreground tab -- the service
      // worker's onBackgroundMessage (public/firebase-messaging-sw.js)
      // covers everything else, but a foreground push doesn't auto-display
      // as a system notification the way a background one does.
      onMessage(messaging, (payload) => {
        if (Notification.permission !== 'granted') return
        new Notification(payload.notification?.title ?? 'QuiroFlow', { body: payload.notification?.body, icon: '/logo/quiroflow-mark.svg' })
      })
    } catch {
      // Best-effort -- the Inbox still works without push.
    }
  }

  return { supported, permission, register }
}
