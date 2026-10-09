import { DEV_PORTAL_SLUGS, isDevPortalHost } from '~/utils/devPortal'

export default defineNuxtRouteMiddleware(async (to) => {
  // The developer portal (developers.quiroflow.com, and the same pages under
  // /developers on the app host) is public documentation -- it has to render
  // for someone with no QuiroFlow account, so it's checked before anything
  // that assumes a session. Its bare-slug aliases are listed too because on
  // the docs subdomain those are the real URLs; see utils/devPortal.ts.
  const isPortalPath = to.path.startsWith('/developers') || DEV_PORTAL_SLUGS.includes(to.path.slice(1))
  if (isPortalPath) return

  // The docs subdomain's root. It can't render the intro page in place --
  // "/" already belongs to the app's sign-in entry point -- so it redirects
  // to the first page instead, which is also the honest URL for it.
  const requestUrl = useRequestURL()
  if (isDevPortalHost(requestUrl.hostname)) {
    return navigateTo('/introduction', { replace: true })
  }

  // A clinic's booking subdomain (<slug>.<appDomain>) should only ever show
  // its booking page, regardless of what path was requested -- checked
  // first so it wins even for a staff user who happens to land here.
  // appDomain is the app's own host (app.quiroflow.com) -- quiroflow.com's
  // bare apex is a separate marketing site, not this app, so it's not
  // handled here at all.
  const appDomain = useRuntimeConfig().public.appDomain
  if (appDomain && !to.path.startsWith('/book/')) {
    const host = requestUrl.hostname.toLowerCase()
    if (host !== appDomain && host.endsWith(`.${appDomain}`)) {
      const slug = host.slice(0, host.length - appDomain.length - 1)
      if (slug && !slug.includes('.')) {
        return navigateTo(`/book/${slug}`, { replace: true })
      }
    }
  }

  if (to.path.startsWith('/portal')) return
  if (to.path.startsWith('/join')) return
  if (to.path.startsWith('/book')) return
  if (to.path.startsWith('/doc/')) return
  // Unsubscribing from a clinic's marketing email: a patient's link, never
  // anything to do with a staff session that happens to be open.
  if (to.path.startsWith('/unsubscribe/')) return
  // Stripe Checkout's return page for a patient paying from the app.
  if (to.path === '/payment-done') return

  const user = useSupabaseUser()
  if (!user.value) return

  // Every composable this middleware needs is resolved HERE, before the
  // first await, and never after one. On the server an await drops Vue's
  // injection context (Nuxt's transform restores only its own app context),
  // so a store resolved after it can't inject this request's Pinia and falls
  // back to Pinia's module-global "active" instance -- whichever request set
  // it last. Under concurrent SSR that was another clinic's store: this
  // request loaded its own account into it, the other request rendered it,
  // and this one rendered empty. When the other request had already finished,
  // the global was unset instead and the page 500ed with "getActivePinia()
  // was called but there was no active Pinia". tests/unit/ssr-context.test.ts
  // fails on a use*() call after an await in here.
  const store = useAccountStore()
  const supabase = useSupabaseClient()
  const twoFactorGate = useTwoFactor()

  // useSupabaseUser() is not the session. @nuxtjs/supabase fills it from
  // getClaims() calls it never cancels, so one that resolves after signOut()
  // writes the old claims straight back. Trusted here, that sent "Sign out"
  // into a loop with no exit: no team member under an anonymous client, so
  // /onboarding; no session, so the module's own redirect back to /login; and
  // round again, forever, while the page sat on an emptied /dashboard. The
  // browser's own session is the answer (a storage read, no request). The
  // server's ref is built from this request's cookies, so it cannot lag.
  if (import.meta.client) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      user.value = null
      return
    }
  }

  // Two-factor goes before anything that reads the account. Until the code
  // is in, the database returns nothing for this person -- and "no
  // team_members row" below means "send them to onboarding to create a new
  // clinic", which is the one place a staff member must never be sent.
  const twoFactor = await twoFactorGate.gate()
  if (twoFactor !== 'ok') {
    if (to.path === '/two-factor') return
    // Where they were going comes along, so a password-reset link still
    // lands on /reset-password once the code is in.
    const next = ['/', '/login', '/signup'].includes(to.path) ? undefined : to.fullPath
    return navigateTo({ path: '/two-factor', query: next ? { next } : {} })
  }
  if (to.path === '/two-factor') return

  if (!store.loaded) {
    await store.load()
  }

  let hasAccount = !!store.teamMember

  // A team member invite was accepted mid-signup (email confirmation breaks
  // the query-string chain), so pick up the pending token here instead.
  //
  // If accepting it fails, the person goes to /join, which says why and keeps
  // the token for another try. This used to throw the token away and fall
  // through to the onboarding redirect below -- so a colleague whose invite
  // was refused (the practice had no free seat, say) was silently asked to
  // create a clinic of their own, and anyone who did ended up in a second,
  // separate account while the owner wondered why nobody had joined.
  if (!hasAccount && import.meta.client) {
    const token = localStorage.getItem('pending_invite_token')
    if (token) {
      const { error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) return navigateTo('/join')
      localStorage.removeItem('pending_invite_token')
      store.reset()
      await store.load()
      hasAccount = !!store.teamMember
    }
  }

  // Somebody with no clinic account is sent to set one up -- unless they are
  // a patient, who belongs on the portal. A patient who signed up in the app
  // and opened the confirmation link here was offered "create your clinic".
  // /onboarding stays reachable on purpose for anyone who asks for it.
  if (!hasAccount && to.path !== '/onboarding') {
    const meta = user.value.user_metadata as { signup_intent?: string } | undefined
    let isPatient = meta?.signup_intent === 'portal'
    if (!isPatient) {
      const { data: own } = await supabase.from('patients').select('id').eq('user_id', user.value.sub).limit(1)
      isPatient = !!own?.length
    }
    return navigateTo(isPatient ? '/portal' : '/onboarding')
  }
  if (hasAccount && ['/onboarding', '/login', '/signup', '/'].includes(to.path)) {
    return navigateTo('/dashboard')
  }

  // Guard against a redirect loop if a role also can't see the Dashboard itself.
  if (hasAccount && to.path !== '/dashboard' && !isRouteAllowed(store, to.path)) {
    return navigateTo('/dashboard?denied=1')
  }
})
