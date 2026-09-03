// Opens Stripe's hosted Customer Portal so an owner can update their payment
// method or pay an outstanding invoice -- used from both the persistent
// banner (past_due) and the full-screen lock (locked/canceled), since a
// locked account can't reach any other page to fix itself.
export function useBillingPortal() {
  const loading = ref(false)

  async function openPortal(fallbackHref: string) {
    loading.value = true
    try {
      const { url } = await $fetch<{ url: string }>('/api/billing/portal-session', { method: 'POST' })
      window.location.href = url
    } catch {
      // Most likely: not the owner, or no Stripe customer yet -- email
      // always works as a fallback.
      window.location.href = fallbackHref
    }
    loading.value = false
  }

  return { loading, openPortal }
}
