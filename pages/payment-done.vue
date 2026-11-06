<script setup lang="ts">
// Where Stripe Checkout lands after "Pagar" in the patient app
// (server/api/portal/invoices/pay-link.post.ts). It opens in the phone's
// browser, with no QuiroFlow session, so it says what happened and sends the
// patient back to the app (or the portal tab it came from); the payment itself is recorded by the webhook.
definePageMeta({ layout: false })

const route = useRoute()
const t = useT()

// Back from the bank's 3-D Secure page for a saved-card payment
// (server/utils/appPayments.ts): passed or failed, the URL looks the same, so
// the outcome is asked for (server/api/pay/intent-status.get.ts). It said
// "Pago recibido" to a patient who had just failed the check.
const checking = computed(() => route.query.status === 'check')
const checked = ref<'paid' | 'processing' | 'failed' | 'unknown' | null>(null)
onMounted(async () => {
  if (!checking.value) return
  try {
    checked.value = (
      await $fetch<{ status: 'paid' | 'processing' | 'failed' }>('/api/pay/intent-status', {
        query: { account: route.query.account, payment_intent: route.query.payment_intent, payment_intent_client_secret: route.query.payment_intent_client_secret },
      })
    ).status
  } catch {
    checked.value = 'unknown'
  }
})

const success = computed(() => (checking.value ? checked.value === 'paid' || checked.value === 'processing' : route.query.status === 'success'))
// From a reminder's pay link (server/api/pay/[token].get.ts): nothing to pay
// any more, a link that is not ours, or no card payments at that clinic.
const other = computed(() => {
  if (route.query.status === 'already_paid') return { title: t('Already paid', 'Ya está pagada'), body: t('This invoice has already been paid. Nothing else to do.', 'Esta factura ya está pagada. No tienes que hacer nada más.') }
  if (route.query.status === 'invalid') return { title: t('Link not valid', 'Enlace no válido'), body: t('This payment link is not valid. Ask the clinic for a new one.', 'Este enlace de pago no es válido. Pide uno nuevo a la clínica.') }
  if (route.query.status === 'unavailable') return { title: t('Card payment unavailable', 'Pago con tarjeta no disponible'), body: t('This clinic does not take card payments online right now. Please contact them.', 'Esta clínica no acepta ahora pagos con tarjeta online. Ponte en contacto con ella.') }
  // Could not be confirmed either way: say where to look rather than guess.
  if (checking.value && checked.value === 'unknown') return { title: t('Payment pending confirmation', 'Pago pendiente de confirmar'), body: t('Go back to the app: it will show whether the payment went through.', 'Vuelve a la app: allí verás si el pago se ha completado.') }
  return null
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div v-if="checking && checked === null" class="max-w-sm text-center" data-cy="payment-done" data-status="checking">
      <p class="text-[15px] font-medium text-ink-900">{{ t('Checking the payment…', 'Comprobando el pago…') }}</p>
    </div>
    <div v-else-if="other" class="max-w-sm text-center" data-cy="payment-done" :data-status="checking ? checked : String(route.query.status)">
      <p class="text-[15px] font-medium text-ink-900">{{ other.title }}</p>
      <p class="mt-1.5 text-[13px] text-ink-muted2">{{ other.body }}</p>
    </div>
    <div v-else class="max-w-sm text-center" data-cy="payment-done" :data-status="success ? 'success' : 'failed'">
      <p class="text-[15px] font-medium text-ink-900">{{ success ? t('Payment received', 'Pago recibido') : t('Payment not made', 'Pago no realizado') }}</p>
      <p class="mt-1.5 text-[13px] text-ink-muted2">
        {{
          success
            ? t('Thank you. You can close this page and go back to the app or the portal: it will show as paid in a moment.', 'Gracias. Puedes cerrar esta página y volver a la app o al portal: en un momento aparecerá como pagado.')
            : t('Nothing was charged. You can close this page and try again from the app or the portal.', 'No se ha cobrado nada. Puedes cerrar esta página e intentarlo de nuevo desde la app o el portal.')
        }}
      </p>
    </div>
  </div>
</template>
