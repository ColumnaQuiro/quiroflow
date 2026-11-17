import { loadFacebookSdk } from './useEmbeddedSignup'

// Connecting something that lives on a clinic's Facebook Page: the same
// FB.login() popup as WhatsApp's Embedded Signup, on the same platform app,
// but a different Login for Business configuration per purpose -- lead ads
// asks for Pages and the lead permissions, Instagram for the Instagram
// account behind a Page and instagram_manage_messages, Meta Ads for an ad
// account and ads_read.
//
// As there, what comes back is a short-lived code, and only the server can
// turn it into a token (/api/meta/lead-pages/connect, /api/meta/instagram/connect,
// /api/meta/ads/connect).

export function useFacebookPageConnect(purpose: 'leadAds' | 'instagram' | 'metaAds' = 'leadAds') {
  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const configId = { leadAds: config.public.metaLeadAdsConfigId, instagram: config.public.metaInstagramConfigId, metaAds: config.public.metaAdsConfigId }[purpose]

  const available = computed(() => Boolean(appId && configId))

  // A USER-token configuration (Meta Ads' -- see metaAdsConfigId in
  // nuxt.config.ts) hands back a code that Meta only exchanges with the exact
  // redirect_uri the dialog was opened with. System-user configurations have
  // no such binding, which is why the other three never needed this.
  //
  // In a popup the JavaScript SDK chooses that redirect_uri itself: its own
  // staticxx.facebook.com/x/connect/xd_arbiter/ page with a per-login token on
  // the end, which the server cannot know. fallback_redirect_uri is only used
  // when popups are blocked (found 16 Nov 2026, after setting it and seeing
  // the same "Error validating verification code"). So for this purpose the
  // URL the SDK opens is read as it opens, and the redirect_uri inside it goes
  // to the server with the code. The app root stays as the fallback, for the
  // no-popup path, and is listed under Valid OAuth Redirect URIs.
  const fallbackRedirectUri = purpose === 'metaAds' && import.meta.client ? `${window.location.origin}/` : null
  let dialogRedirectUri: string | null = null

  /** Resolves with the code; rejects with 'CANCELLED' when the dialog is closed. */
  async function launch(): Promise<string> {
    if (!available.value) throw new Error('This Meta connection is not configured on this deployment.')
    await loadFacebookSdk(appId)

    dialogRedirectUri = null
    const originalOpen = fallbackRedirectUri ? window.open : null
    if (originalOpen) {
      window.open = function (url?: string | URL, ...rest: any[]) {
        try {
          const found = url ? new URL(String(url), window.location.href).searchParams.get('redirect_uri') : null
          if (found) dialogRedirectUri = found
        } catch {
          // Not a URL we can read; the fallback still goes.
        }
        return originalOpen.call(window, url as any, ...rest)
      } as typeof window.open
    }

    try {
      return await new Promise<string>((resolve, reject) => {
        window.FB.login(
          (response: any) => {
            const code = response?.authResponse?.code
            if (code) resolve(code)
            else reject(new Error('CANCELLED'))
          },
          { config_id: configId, response_type: 'code', override_default_response_type: true, ...(fallbackRedirectUri ? { fallback_redirect_uri: fallbackRedirectUri } : {}) },
        )
      })
    } finally {
      if (originalOpen) window.open = originalOpen
    }
  }

  /** The redirect_uri(s) the last code may be bound to, most likely first. Empty for a system-user configuration. */
  function redirectUris(): string[] {
    return [dialogRedirectUri, fallbackRedirectUri].filter((u): u is string => Boolean(u))
  }

  return { available, launch, redirectUris }
}
