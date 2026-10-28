import { loadFacebookSdk } from './useEmbeddedSignup'

// Connecting something that lives on a clinic's Facebook Page: the same
// FB.login() popup as WhatsApp's Embedded Signup, on the same platform app,
// but a different Login for Business configuration per purpose -- lead ads
// asks for Pages and the lead permissions, Instagram for the Instagram
// account behind a Page and instagram_manage_messages.
//
// As there, what comes back is a short-lived code, and only the server can
// turn it into a token (/api/meta/lead-pages/connect, /api/meta/instagram/connect).

export function useFacebookPageConnect(purpose: 'leadAds' | 'instagram' = 'leadAds') {
  const config = useRuntimeConfig()
  const appId = config.public.metaPlatformAppId
  const configId = purpose === 'instagram' ? config.public.metaInstagramConfigId : config.public.metaLeadAdsConfigId

  const available = computed(() => Boolean(appId && configId))

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
        { config_id: configId, response_type: 'code', override_default_response_type: true },
      )
    })
  }

  return { available, launch }
}
