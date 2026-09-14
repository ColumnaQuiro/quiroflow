import { DEV_PORTAL_ORIGIN, isDevPortalHost } from '~/utils/devPortal'

// robots.txt has to differ per hostname, which is why it's a route rather
// than the static public/robots.txt it replaces.
//
// That static file said `Disallow: /` for the whole site. Correct for the
// app -- app.quiroflow.com is a staff tool with nothing to index -- but the
// developer portal is served by this same site, so the one file blocked
// developers.quiroflow.com too. The portal's per-page
// `<meta name="robots" content="index, follow">` could not rescue it:
// robots.txt is consulted *before* the page is fetched, so a disallowed URL
// never gets far enough for its meta tag to be read. The public
// documentation was unreachable to search engines while looking, in the
// HTML, as though it were indexable.
export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  if (isDevPortalHost(getRequestURL(event).hostname)) {
    return `User-Agent: *\nAllow: /\n\nSitemap: ${DEV_PORTAL_ORIGIN}/sitemap.xml\n`
  }

  // The app host ASKS to be crawled, which looks backwards for a staff tool
  // and is the only way to keep it out of the index.
  //
  // It used to say `Disallow: /`, paired with a noindex meta tag. That pair
  // cancels out: robots.txt is read before the page is fetched, so a crawler
  // obeying the disallow never sees the tag, and a URL someone links to gets
  // indexed regardless -- which is how the login page ended up in Google with
  // its own text as the snippet. Refusing the crawl is precisely what stopped
  // us retracting it.
  //
  // The refusal is now the X-Robots-Tag header on every response from this
  // host (server/middleware/noindex.ts), which a crawler can only obey by
  // fetching the page. Nothing here is worth crawling and everything real is
  // behind auth, so the crawl costs a redirect to /login and buys the one
  // thing the disallow made impossible: pages leaving the index.
  return 'User-Agent: *\nAllow: /\n'
})
