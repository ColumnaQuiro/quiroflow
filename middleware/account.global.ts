// Subdomains that are the app itself, not a clinic's booking page --
// quiroflow.com's bare apex is reserved for a separate marketing site, so
// "app" is the real entry point here alongside the conventional "www".
const RESERVED_SUBDOMAINS = ['app', 'www']

export default defineNuxtRouteMiddleware(async (to) => {
  // A clinic's booking subdomain (<slug>.<appDomain>) should only ever show
  // its booking page, regardless of what path was requested -- checked
  // first so it wins even for a staff user who happens to land here.
  const appDomain = useRuntimeConfig().public.appDomain
  if (appDomain && !to.path.startsWith('/book/')) {
    const host = useRequestURL().hostname.toLowerCase()
    if (host !== appDomain && host.endsWith(`.${appDomain}`)) {
      const slug = host.slice(0, host.length - appDomain.length - 1)
      if (slug && !slug.includes('.') && !RESERVED_SUBDOMAINS.includes(slug)) {
        return navigateTo(`/book/${slug}`, { replace: true })
      }
    }
  }

  if (to.path.startsWith('/portal')) return
  if (to.path.startsWith('/join')) return
  if (to.path.startsWith('/book')) return

  const user = useSupabaseUser()
  if (!user.value) return

  const store = useAccountStore()
  if (!store.loaded) {
    await store.load()
  }

  let hasAccount = !!store.teamMember

  // A team member invite was accepted mid-signup (email confirmation breaks
  // the query-string chain), so pick up the pending token here instead.
  if (!hasAccount && import.meta.client) {
    const token = localStorage.getItem('pending_invite_token')
    if (token) {
      const supabase = useSupabaseClient()
      const { error } = await supabase.rpc('accept_invite', { p_token: token })
      localStorage.removeItem('pending_invite_token')
      if (!error) {
        store.reset()
        await store.load()
        hasAccount = !!store.teamMember
      }
    }
  }

  if (!hasAccount && to.path !== '/onboarding') {
    return navigateTo('/onboarding')
  }
  if (hasAccount && ['/onboarding', '/login', '/signup', '/'].includes(to.path)) {
    return navigateTo('/dashboard')
  }
})
