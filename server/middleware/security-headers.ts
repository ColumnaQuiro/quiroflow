// Response headers that say where a page may be framed from, and what a
// link away from it may learn.
//
// Until this existed the app sent neither X-Frame-Options nor a
// Content-Security-Policy, so any site could put app.quiroflow.com -- the
// sign-in page, a staff member's open session -- inside an invisible iframe
// and lay its own buttons over it (clickjacking). Both headers are set, not
// one: frame-ancestors is the standard and wins where both are understood,
// X-Frame-Options is what older WebViews still read.
//
// The booking widget is the one page that MUST be framed by other sites:
// clinics put /book/<slug> in an iframe on their own website, and
// public/embed.js exists to make that work. Everything under /book/ is
// therefore left open to any ancestor. Nothing else is: the app frames its
// own PDF previews (components/patients/FilesTab.vue) from a storage URL on
// another origin, so 'self' costs it nothing.
//
// Referrer-Policy: a patient's document link (/doc/<token>), a pay link, an
// unsubscribe link all carry a capability in the path. With the browser
// default those paths travel in the Referer header to any site a link on the
// page opens. strict-origin-when-cross-origin sends only the origin
// cross-site and keeps the full path for our own navigation.
//
// Permissions-Policy: the app records audio (useAudioRecorder) and takes
// photos, both from its own pages; it never asks for location. Naming them
// stops an embedded third party from inheriting the microphone or the
// camera, and turns a stray geolocation prompt into a refusal. `payment` is
// deliberately not listed: Stripe's own iframes use it, and the browser
// default already lets them.
export default defineEventHandler((event) => {
  const path = event.path
  const embeddable = path === '/book' || path.startsWith('/book/') || path.startsWith('/book?')

  if (embeddable) {
    setHeader(event, 'Content-Security-Policy', 'frame-ancestors *')
  } else {
    setHeader(event, 'Content-Security-Policy', "frame-ancestors 'self'")
    setHeader(event, 'X-Frame-Options', 'SAMEORIGIN')
  }
  setHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setHeader(event, 'Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
})
