// The developer portal is served from this same Nuxt app but is reachable at
// two URL shapes, and this is the one list both of them are built from.
//
//   developers.quiroflow.com/authentication   (the canonical, public one)
//   app.quiroflow.com/developers/authentication
//
// Rather than a CDN rewrite -- which would leave the server rendering
// /developers/authentication while the browser's URL said /authentication,
// and hand the client router a path it can't match -- nuxt.config registers a
// prefix-free alias route for each page below. Both hosts then resolve the
// same component on the server and in the browser, with no rewrite in play
// and nothing to keep in sync at the edge.
//
// A page added here appears in the sidebar and gets its alias automatically.

export interface DevPortalPage {
  slug: string
  en: string
  es: string
}

export const DEV_PORTAL_SECTIONS: { en: string; es: string; pages: DevPortalPage[] }[] = [
  {
    en: 'Getting started',
    es: 'Primeros pasos',
    pages: [
      { slug: 'introduction', en: 'Introduction', es: 'Introducción' },
      { slug: 'authentication', en: 'Authentication', es: 'Autenticación' },
      { slug: 'base-url', en: 'Base URL & versioning', es: 'URL base y versiones' },
    ],
  },
  {
    en: 'Core concepts',
    es: 'Conceptos básicos',
    pages: [
      { slug: 'pagination', en: 'Pagination', es: 'Paginación' },
      { slug: 'filtering', en: 'Filtering & sorting', es: 'Filtrado y ordenación' },
      { slug: 'errors', en: 'Errors', es: 'Errores' },
      { slug: 'rate-limits', en: 'Rate limits', es: 'Límites de uso' },
    ],
  },
  {
    en: 'Reference',
    es: 'Referencia',
    pages: [
      { slug: 'reference', en: 'Endpoints', es: 'Endpoints' },
      { slug: 'webhooks', en: 'Webhooks', es: 'Webhooks' },
      { slug: 'changelog', en: 'Changelog', es: 'Registro de cambios' },
    ],
  },
]

export const DEV_PORTAL_SLUGS = DEV_PORTAL_SECTIONS.flatMap((section) => section.pages.map((page) => page.slug))

// Canonical home of the docs. Also what the canonical <link> on every portal
// page points at, so the /developers/* copies on the app host don't compete
// with it in search results.
export const DEV_PORTAL_ORIGIN = 'https://developers.quiroflow.com'

export function isDevPortalHost(hostname: string) {
  return hostname.toLowerCase().startsWith('developers.')
}

// Links inside the portal have to work on both hosts: bare on the docs
// subdomain, /developers-prefixed on the app.
export function devPortalPath(slug: string, onDevHost: boolean) {
  return onDevHost ? `/${slug}` : `/developers/${slug}`
}
