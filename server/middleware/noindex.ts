import { isDevPortalHost } from '~/utils/devPortal'

// X-Robots-Tag: noindex on every response from the app host.
//
// app.quiroflow.com was blocked from indexing on 2026-08-25 two ways at once
// -- robots.txt `Disallow: /` and a `<meta name="robots" content="noindex">`
// in nuxt.config -- and the login page is in Google anyway, with its real
// text ("Email. Password. Sign in. Forgot password?") as the snippet.
//
// The two directives cancel each other. robots.txt is consulted BEFORE the
// page is fetched, so a crawler that obeys `Disallow: /` never loads the HTML
// and never reads the noindex meta tag inside it. Google is explicit that a
// disallowed URL can still be indexed when something links to it, and that a
// noindex it is not allowed to fetch cannot be acted on. Blocking the crawl
// is what preserved the entry: the page was crawlable from launch until the
// 25th, Google indexed it in that window, and the disallow then froze that
// record in place with no way for us to retract it.
//
// So the app now invites the crawl and refuses the index. This header is the
// directive rather than the meta tag because it does not depend on the HTML
// being fetched, parsed or rendered, and it covers what a meta tag cannot --
// PDFs (an invoice served from /api/invoices/:id/pdf), JSON, anything.
//
// Not on the developer portal: developers.quiroflow.com is public
// documentation that is supposed to rank, which is the whole point of 07b3a44.
export default defineEventHandler((event) => {
  if (isDevPortalHost(getRequestURL(event).hostname)) return
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
})
