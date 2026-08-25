// Staff-facing server routes (Stripe schedules, automations, etc.) authenticate
// via requireTeamMember/requirePermission, which reads the session from an
// httpOnly cookie by default -- same as every other page in the app. That
// cookie is written by @nuxtjs/supabase's client-side auth-state listener,
// but on a long-lived session it can fall out of sync with the in-memory
// session the browser SDK is actually using (a token refresh update to one
// doesn't guarantee the other), causing a plain $fetch to these routes to
// fail with "Not signed in as a team member" even though the user is
// clearly still signed in everywhere else in the UI. requireTeamMember
// already has a working fallback for exactly this kind of mismatch -- an
// Authorization: Bearer <token> header, used today by the mobile app's
// cookie-less requests (server/utils/requirePermission.ts) -- so sending
// the browser SDK's own current access token the same way sidesteps
// whatever's stale in the cookie instead of trusting it.
//
// Reads the token via supabase.auth.getSession() rather than the
// useSupabaseSession() reactive ref: that ref is only as fresh as the last
// auth-state-change event this tab happened to receive, which on a
// long-lived tab can itself go stale (observed live -- a session held open
// for hours sent a Bearer token that 403'd even though the cookie and
// supabase.auth.getSession() both had a valid, current one). getSession()
// forces the SDK to check/refresh before returning, so this can't go stale
// in either direction. Same pattern mobile's useAuthedFetch already uses.
export async function useStaffFetch<T = unknown>(url: string, opts: Record<string, any> = {}): Promise<T> {
  const supabase = useSupabaseClient()
  const { data } = await supabase.auth.getSession()
  const headers = { ...(opts.headers as Record<string, string> | undefined) }
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`
  return $fetch(url, { ...opts, headers }) as Promise<T>
}
