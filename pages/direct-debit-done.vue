<script setup lang="ts">
// Where GoCardless's sign-up page sends the patient back, from the
// direct-debit link a clinic sends (server/api/gocardless/mandates/request).
// ?status=cancelled is its exit link: they left without signing. The mandate
// itself is paired with the patient by the billing_requests webhook, not here.
definePageMeta({ layout: false })

const route = useRoute()
const t = useT()
const success = computed(() => route.query.status !== 'cancelled')
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4 py-10" data-cy="direct-debit-done">
    <BookingResult :tone="success ? 'success' : 'neutral'" :title="success ? t('Direct debit set up', 'Domiciliación configurada') : t('Direct debit not set up', 'Domiciliación no configurada')">
      <p>
        <template v-if="success">{{ t('Thanks -- your clinic can now collect by direct debit from your account. You can close this window now.', 'Gracias, su clínica ya puede cobrarle por domiciliación bancaria. Ya puede cerrar esta ventana.') }}</template>
        <template v-else>{{ t('Nothing was set up. You can close this window and open the link again whenever you like.', 'No se ha configurado nada. Puede cerrar esta ventana y volver a abrir el enlace cuando quiera.') }}</template>
      </p>
    </BookingResult>
  </div>
</template>
