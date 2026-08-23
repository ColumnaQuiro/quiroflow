// The web app's server/api/** routes authenticate via a cookie
// (server/utils/requirePermission.ts). This app has no cookie -- Capacitor's
// WebView origin can't reliably carry one cross-origin -- so every call
// attaches the current Supabase access token as a Bearer header instead,
// which that same server util already accepts as an alternate auth path.
export function useAuthedFetch() {
  const supabase = useSupabaseClient()

  return async function authedFetch<T>(url: string, opts: Parameters<typeof $fetch>[1] = {}) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return $fetch<T>(url, {
      ...opts,
      headers: { ...(opts?.headers as Record<string, string> | undefined), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  }
}
