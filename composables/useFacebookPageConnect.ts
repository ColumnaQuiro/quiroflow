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
  // nuxt.config.ts) hands back a code that Meta will only exchange with the
  // redirect_uri the dialog was opened with, and the JavaScript SDK otherwise
  // picks one of its own that nobody can repeat on the server: the exchange
  // failed with "Error validating verification code. Please make sure your
  // redirect_uri is identical..." (16 Nov 2026). So that purpose names one,
  // the app's own root, which is listed under Facebook Login for Business >
  // Settings > Valid OAuth Redirect URIs, and the server sends it back.
  // System-user configurations need none and keep working as they did.
  const redirectUri = purpose === 'metaAds' && import.meta.client ? `${window.location.origin}/` : null

  /** Resolves with the code; rejects with 'CANCELLED' when the dialog is closed. */
  async function launch(): Promise<string> {
    if (!available.value) throw new Error('This Meta connection is not configured on this deployment.')
    await loadFacebookSdk(appId)

    return new Promise<string>((resolve, reject) => {
      window.FB.login(
        (response: any) => {
          const code = response?.authResponse?.code
          if (code) resolve(code)
          else reject(new Error('CANCELLED'))
        },
        { config_id: configId, response_type: 'code', override_default_response_type: true, ...(redirectUri ? { fallback_redirect_uri: redirectUri } : {}) },
      )
    })
  }

  return { available, launch, redirectUri }
}
