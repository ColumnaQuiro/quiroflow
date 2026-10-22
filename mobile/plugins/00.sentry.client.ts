import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import * as Sentry from '@sentry/capacitor'
import * as SentryVue from '@sentry/vue'
import type { RouteLocationNormalized } from 'vue-router'

// Crash and error reporting for the app, to the Sentry project quiroflow-app
// (the web's is javascript-nuxt). Before this, an app that closed on someone
// was known only from what they told the clinic, and App Store crash reports
// arrive days later and only from people who share analytics.
//
// It captures both layers:
//   * JavaScript errors in the WebView -- the screens, through the Vue
//     integration -- and
//   * native crashes, through sentry-cocoa and sentry-android, which
//     @sentry/capacitor starts first: a crash in Swift/Kotlin, Firebase or a
//     Capacitor plugin is written to disk and sent on the next launch.
//
// Native devices only, and only when the build was given
// NUXT_PUBLIC_SENTRY_DSN (ci_post_clone.sh on Xcode Cloud, mobile/.env for
// Android), so `nuxt dev` in a browser and a local build send nothing.
// First of the plugins (00.) so that an error in any of the others is caught.
//
// Errors only, as on the web: no tracing, no Session Replay. What is sent is
// scrubbed by mobile/utils/sentryAppPrivacy.ts -- no names, emails, phone
// numbers or record ids. The person is not identified at all; the tags say
// which app version, platform and side of the app (patient or staff).
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public
  if (!Capacitor.isNativePlatform() || !config.sentryDsn) return
  const user = useSupabaseUser()

  Sentry.init(
    {
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      // release and dist are left to the native SDK, which reads them from
      // the bundle: com.quiroflow.app@<MARKETING_VERSION>+<build number>
      // (versionName+versionCode on Android), the same for JS and native
      // events. Native stacks are matched to their dSYM / mapping by debug
      // id, not by release.
      dataCollection: SENTRY_DATA_COLLECTION,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (event) => scrubAppEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubAppBreadcrumb(breadcrumb),
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
      ],
      siblingOptions: {
        // attachProps: a screen's props are its patient.
        vueOptions: { app: nuxtApp.vueApp, attachProps: false },
      },
    },
    SentryVue.init,
  )

  Sentry.setTag('platform', Capacitor.getPlatform())
  // The same numbers the release carries, as tags so they can be filtered
  // on directly: "only build 333".
  App.getInfo()
    .then(({ version, build }) => Sentry.setTags({ app_version: version, app_build: build }))
    .catch(() => {})

  // A failure while the app starts (a plugin throwing) never reaches Vue's
  // error handler: Nuxt catches it and shows its error screen.
  nuxtApp.hook('app:error', (error) => {
    Sentry.captureException(error)
  })

  // Which side of the app the person is on, from the screen's layout: the
  // practitioner screens are staff, the patient ones patients. '/' is both
  // until the app knows who signed in (staff are sent on to My Day), so it
  // keeps whatever was known before, until pages/index.vue shows the patient
  // tabs -- which it does only once the person is known to be a patient.
  let role = 'signed_out'
  const setRole = (next: string) => {
    if (next !== role) Sentry.setTag('role', (role = next))
  }
  const roleOf = (to: RouteLocationNormalized) => {
    if (!user.value) return 'signed_out'
    if (to.meta.layout === 'practitioner' || to.path.startsWith('/reception')) return 'staff'
    if (to.meta.layout === 'patient' && to.path !== '/') return 'patient'
    return role === 'signed_out' ? 'unknown' : role
  }
  const router = useRouter()
  router.afterEach((to) => setRole(roleOf(to)))
  watch(usePatientTabsVisible(), (visible) => {
    if (visible && user.value && router.currentRoute.value.path === '/') setRole('patient')
  })
  Sentry.setTag('role', role)
})
