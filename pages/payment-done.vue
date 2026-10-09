<script setup lang="ts">
// Where Stripe Checkout lands after "Pagar" in the patient app
// (server/api/portal/invoices/pay-link.post.ts). It opens in the phone's
// browser, with no QuiroFlow session, so it says what happened and sends the
// patient back to the app (or the portal tab it came from); the payment itself is recorded by the webhook.
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
            ? t('Thank you. You can close this page and go back to the app or the portal: it will show as paid in a moment.', 'Gracias. Puedes cerrar esta página y volver a la app o al portal: en un momento aparecerá como pagado.')
            : t('Nothing was charged. You can close this page and try again from the app or the portal.', 'No se ha cobrado nada. Puedes cerrar esta página e intentarlo de nuevo desde la app o el portal.')
        }}
      </p>
    </div>
  </div>
</template>
