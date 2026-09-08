import { DEV_PORTAL_ORIGIN, DEV_PORTAL_SLUGS, isDevPortalHost } from '~/utils/devPortal'

// Sitemap for the developer portal only. Built from the same slug list that
// builds its sidebar and its alias routes, so a page added there is listed
// here without anyone remembering to.
//
// The app host has no sitemap: it's a staff tool behind a login, and its
// robots.txt disallows everything.
export default defineEventHandler((event) => {
  if (!isDevPortalHost(getRequestURL(event).hostname)) {
    // Plain-text 404 rather than createError(): throwing here makes Nitro
    // fall through to the HTML error page, which runs the app's page
    // middleware, which 302s to /login. A crawler asking the app host for a
    // sitemap would get a login page with a 200 -- worse than a 404, and the
    // reason the Cypress assertion below exists.
    setResponseStatus(event, 404)
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return 'Not found\n'
  }

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  const urls = DEV_PORTAL_SLUGS.map(
    (slug) => `  <url>\n    <loc>${DEV_PORTAL_ORIGIN}/${slug}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`,
  ).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
})
