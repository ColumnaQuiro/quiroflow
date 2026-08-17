export default defineNuxtRouteMiddleware(async (to) => {
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
