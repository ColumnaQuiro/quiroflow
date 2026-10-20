// Handles push notifications that arrive while no QuiroFlow tab is focused
// (or the browser is closed). A plain static file, not a Nuxt page -- the
// browser registers it at the origin root, and it can't read Nuxt's runtime
// config, so the (non-secret, see nuxt.config.ts's firebaseWebConfig comment)
// values below are duplicated rather than shared.
importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyAxzrb1SFgtc5yFgvlIc5w1NJFTKMUaJLA',
  authDomain: 'quiroflow-b3a5b.firebaseapp.com',
  projectId: 'quiroflow-b3a5b',
  storageBucket: 'quiroflow-b3a5b.firebasestorage.app',
  messagingSenderId: '972446092693',
  appId: '1:972446092693:web:01dcbf0f547de4ba803a9c',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'QuiroFlow'
  self.registration.showNotification(title, {
    body: payload.notification?.body,
    icon: '/logo/quiroflow-mark.svg',
    data: payload.data,
  })
})

// Clicking the notification should land on the Inbox, on the conversation
// that actually triggered it when we know which one (the "key" set below
// matches the same patient_id/phone_number the Inbox groups threads by).
// An existing tab used to only get focus()'d, never navigated -- landing
// wherever it already was (Calendar, Patients, ...) instead of the Inbox,
// which read as the notification just not working.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // A push that names its own page (team messages: data.url) goes there;
  // only a same-origin path is honoured, never a full URL from a payload.
  const data = event.notification.data || {}
  const key = data.key
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : key ? `/inbox?open=${encodeURIComponent(key)}` : '/inbox'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.registration.scope))
      if (existing) return 'navigate' in existing ? existing.navigate(url).then((c) => c.focus()) : existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})
