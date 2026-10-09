// "Pagar" on a patient's unpaid invoice, in the app and the portal: a
// Stripe-hosted Checkout page for what is still owed on it
// (server/api/portal/invoices/pay-link.post.ts), offered only where the
// clinic takes card payments online. Nothing here records money -- the
// webhook does, as for any card payment against an invoice.
//
// onReturn runs when the page is shown again after a payment was opened from
// it (the patient back from the browser tab or the system browser), so the
// invoice can be re-read: the webhook may have marked it paid by then.
export function usePatientPay(onReturn: () => void) {
  const t = useT()
  const authedFetch = useAuthedFetch()
  const enabled = ref(false)
  const payingId = ref<string | null>(null)
  const error = ref('')
  let opened = false

  onMounted(async () => {
    try {
      enabled.value = (await authedFetch<{ enabled: boolean }>('/api/portal/invoices/payable')).enabled
    } catch {
      enabled.value = false
    }
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
  function onVisible() {
    if (document.visibilityState === 'visible' && opened) {
      opened = false
      onReturn()
    }
  }

  async function pay(invoiceId: string) {
    payingId.value = invoiceId
    error.value = ''
    try {
      await openWhenReady(async () => (await authedFetch<{ url: string }>('/api/portal/invoices/pay-link', { method: 'POST', body: { invoiceId } })).url)
      opened = true
    } catch (err) {
      error.value =
        (err as { data?: { statusMessage?: string } })?.data?.statusMessage === 'This invoice is already settled.'
          ? t('That invoice is already paid.', 'Esa factura ya está pagada.')
          : t("Couldn't open the payment. Try again.", 'No se ha podido abrir el pago. Inténtalo de nuevo.')
    } finally {
      payingId.value = null
    }
  }

  return { enabled, payingId, error, pay }
}
