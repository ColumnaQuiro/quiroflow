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
  if (isDevPortalHost(useRequestURL().hostname)) {
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
    const host = useRequestURL().hostname.toLowerCase()
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

  const user = useSupabaseUser()
  if (!user.value) return

  // Two-factor goes before anything that reads the account. Until the code
  // is in, the database returns nothing for this person -- and "no
  // team_members row" below means "send them to onboarding to create a new
  // clinic", which is the one place a staff member must never be sent.
  const twoFactor = await useTwoFactor().gate()
  if (twoFactor !== 'ok') {
    if (to.path === '/two-factor') return
    // Where they were going comes along, so a password-reset link still
    // lands on /reset-password once the code is in.
    const next = ['/', '/login', '/signup'].includes(to.path) ? undefined : to.fullPath
    return navigateTo({ path: '/two-factor', query: next ? { next } : {} })
  }
  if (to.path === '/two-factor') return

  const store = useAccountStore()
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
      const supabase = useSupabaseClient()
      const { error } = await supabase.rpc('accept_invite', { p_token: token })
      if (error) return navigateTo('/join')
      localStorage.removeItem('pending_invite_token')
      store.reset()
      await store.load()
      hasAccount = !!store.teamMember
    }
  }

  if (!hasAccount && to.path !== '/onboarding') {
    return navigateTo('/onboarding')
  }
  if (hasAccount && ['/onboarding', '/login', '/signup', '/'].includes(to.path)) {
    return navigateTo('/dashboard')
  }

  // Guard against a redirect loop if a role also can't see the Dashboard itself.
  if (hasAccount && to.path !== '/dashboard' && !isRouteAllowed(store, to.path)) {
    return navigateTo('/dashboard?denied=1')
  }
})
