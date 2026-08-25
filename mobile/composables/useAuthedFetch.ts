// The web app's server/api/** routes authenticate via a cookie
// (server/utils/requirePermission.ts). This app has no cookie -- Capacitor's
// WebView origin can't reliably carry one cross-origin -- so every call
// attaches the current Supabase access token as a Bearer header instead,
// which that same server util already accepts as an alternate auth path.
//
// A relative URL like '/api/whatsapp/inbox-send' resolves against the
// WebView's own origin (capacitor://localhost on iOS) -- there's no server
// there, only the static bundle, so every relative /api/ call was silently
// going nowhere (a network-level failure, not an HTTP error response) with
// no visible error. Prefixing with apiBase makes it a real absolute request
// to the deployed app instead; server/middleware/cors.ts is the matching
// server-side fix that lets a capacitor://localhost origin actually read
// the response.
export function useAuthedFetch() {
  const supabase = useSupabaseClient()
  const config = useRuntimeConfig()

  return async function authedFetch<T>(url: string, opts: Parameters<typeof $fetch>[1] = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const absoluteUrl = /^https?:\/\//.test(url) ? url : `${config.public.apiBase}${url}`
    return $fetch<T>(absoluteUrl, {
      ...opts,
      headers: { ...(opts?.headers as Record<string, string> | undefined), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }
}
