import { DEV_PORTAL_ORIGIN, DEV_PORTAL_SECTIONS, devPortalPath, isDevPortalHost } from '~/utils/devPortal'

// Everything a portal page needs to render links and metadata correctly on
// whichever of the two hosts it's being served from.
//
// The portal is intentionally English-only, unlike the rest of the app: API
// documentation is read by developers, who are not necessarily the Spanish
// speaking clinic staff useT() serves, and a half-translated reference is
// worse than an untranslated one. Spanish page titles live in
// utils/devPortal.ts for the day that changes.
export function useDevPortal() {
  const onDevHost = computed(() => isDevPortalHost(useRequestURL().hostname))

  function link(slug: string) {
    return devPortalPath(slug, onDevHost.value)
  }

  // Every page canonicalises to developers.quiroflow.com. The /developers/*
  // copies on the app host are real, working URLs -- they just shouldn't
  // compete with the canonical ones in search results.
  function useDocHead(title: string, description: string, slug: string) {
    useHead({
      title: `${title} · QuiroFlow API`,
      meta: [
        { name: 'description', content: description },
        // Overrides the app-wide noindex from nuxt.config: the portal is the
        // one part of this deployment that is meant to be found.
        { name: 'robots', content: 'index, follow' },
        { property: 'og:title', content: `${title} · QuiroFlow API` },
        { property: 'og:description', content: description },
      ],
      link: [{ rel: 'canonical', href: `${DEV_PORTAL_ORIGIN}/${slug}` }],
    })
  }

  return { onDevHost, link, useDocHead, sections: DEV_PORTAL_SECTIONS }
}
