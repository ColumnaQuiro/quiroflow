<script setup lang="ts">
// Where Stripe Checkout lands after "Pagar" in the patient app
// (server/api/portal/invoices/pay-link.post.ts). It opens in the phone's
// browser, with no QuiroFlow session, so it says what happened and sends the
// patient back to the app; the payment itself is recorded by the webhook.
definePageMeta({ layout: false })

const route = useRoute()
const t = useT()
const success = computed(() => route.query.status === 'success')
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="max-w-sm text-center" data-cy="payment-done">
      <p class="text-[15px] font-medium text-ink-900">{{ success ? t('Payment received', 'Pago recibido') : t('Payment not made', 'Pago no realizado') }}</p>
      <p class="mt-1.5 text-[13px] text-ink-muted2">
        {{
          success
            ? t('Thank you. You can go back to the app: it will show as paid in a moment.', 'Gracias. Puedes volver a la app: en un momento aparecerá como pagado.')
            : t('Nothing was charged. You can go back to the app and try again.', 'No se ha cobrado nada. Puedes volver a la app e intentarlo de nuevo.')
        }}
      </p>
    </div>
  </div>
</template>
