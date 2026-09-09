// Opens Stripe's hosted Customer Portal so an owner can update their payment
// method or pay an outstanding invoice -- used from the persistent past_due
// banner and from /subscription. Deliberately NOT the lock screen's action:
// the portal only exists once there's a Stripe customer, so an expired trial
// that never subscribed would fall through to the mailto and have no way to
// pay. That case needs Checkout, which /subscription offers.
export function useBillingPortal() {
  const loading = ref(false)

  async function openPortal(fallbackHref: string, flow?: 'cancel') {
    loading.value = true
    try {
      const { url } = await $fetch<{ url: string }>('/api/billing/portal-session', { method: 'POST', body: flow ? { flow } : undefined })
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
