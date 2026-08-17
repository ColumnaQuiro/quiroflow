export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/portal')) return

  const user = useSupabaseUser()
  if (!user.value) return

  const store = useAccountStore()
  if (!store.loaded) {
    await store.load()
  }

  const hasAccount = !!store.teamMember
  if (!hasAccount && to.path !== '/onboarding') {
    return navigateTo('/onboarding')
  }
  if (hasAccount && ['/onboarding', '/login', '/signup', '/'].includes(to.path)) {
    return navigateTo('/dashboard')
  }
})
