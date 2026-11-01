// Nuxt prefetches every chunk the entry can import dynamically, and the
// layouts are among them -- so the HTML of EVERY page, the booking page
// included, carried ~50 <link rel="prefetch"> for the staff shell (sidebar,
// command palette, cash-shift modal and what they import): ~130 KB gzipped
// fetched on a patient's phone, usually on mobile data, for screens they
// will never open. These pages are opened from a link a clinic sent or
// published, by someone with no staff session, and are the whole visit; a
// patient who does go further (the booking page's own payment step) loads
// that chunk on demand. Staff pages keep their prefetches.
const PATIENT_PAGE = /^\/(book|regalo|valorar|aprende|unsubscribe|doc|check-in|waitlist|photo-upload)\/[^/]+|^\/payment-done(\/|$)/

export default defineNuxtPlugin((nuxtApp) => {
  const ssrContext = nuxtApp.ssrContext
  if (!ssrContext || !PATIENT_PAGE.test(ssrContext.url.split('?')[0]!)) return
  // The renderer adds these links to the same head after the app has
  // rendered, so they can only be removed as the tags are resolved.
  ssrContext.head.hooks.hook('tags:resolve', (ctx) => {
    ctx.tags = ctx.tags.filter((tag) => !(tag.tag === 'link' && tag.props.rel === 'prefetch'))
  })
})
