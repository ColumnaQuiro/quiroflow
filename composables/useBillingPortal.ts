// Opens Stripe's hosted Customer Portal so an owner can update their payment
// method or pay an outstanding invoice -- used from the persistent past_due
// banner and from /subscription.
//
// The portal only exists once the account HAS a Stripe customer, which is why
// callers must not reach for it to collect a first card: portal-session
// answers 400 for an account that has never subscribed, and there is nothing
// this composable can do about that. Collecting a first card is Checkout's
// job (/api/billing/subscribe), and /subscription routes to it.
//
// This used to swallow every failure and do `window.location.href =
// fallbackHref`, a mailto:. That turned four very different situations --
// not the owner, no Stripe customer, Stripe misconfigured on the deployment,
// a network blip -- into one silent outcome: the clinic's mail client opened,
// unasked, and the page they were on was gone. It also meant nobody ever
// found out the portal was failing, because a mail window is not an error
// message. The trial banner's "Add payment method" button did this on EVERY
// click for EVERY trial, since a trialing account has no customer by
// definition, and it read as "this button writes an email".
//
// So a failure now says what went wrong and leaves the page where it is.
// Email is still offered -- as a link the owner can choose, in `contactHref`
// -- rather than as something that happens to them.
export function useBillingPortal() {
  const loading = ref(false)
  /** The last failure, for a caller that wants to render it inline. */
  const error = ref('')
  const { showToast } = useToast()
  const t = useT()

  async function openPortal(flow?: 'cancel') {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const { url } = await $fetch<{ url: string }>('/api/billing/portal-session', { method: 'POST', body: flow ? { flow } : undefined })
      window.location.href = url
    } catch (err: unknown) {
      // statusMessage carries the reason the endpoint actually gave ("Only
      // the account owner can manage billing", "No billing account yet"),
      // which is more use to the person reading it than a status code.
      const detail = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      error.value = detail || t('Could not open the billing portal.', 'No se pudo abrir el portal de facturación.')
      console.error('[billing] portal-session failed:', detail ?? err)
      showToast(error.value, 'error')
    } finally {
      loading.value = false
    }
  }

  return { loading, error, openPortal }
}
