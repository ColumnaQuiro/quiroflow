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

  // The app host keeps exactly what public/robots.txt used to say. The
  // /developers/* copies that also live here stay disallowed on purpose:
  // they canonicalise to the docs subdomain, so there is nothing to gain
  // from having them crawled here and a duplicate-content risk in it.
  return 'User-Agent: *\nDisallow: /\n'
})
