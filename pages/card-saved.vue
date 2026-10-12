<script setup lang="ts">
// Where Stripe's card page sends the patient back: from the "Card link" staff
// send, or straight after an online booking when the clinic asks for a card
// (?booking=1, server/api/public-booking/book.post.ts). The card itself is
// recorded by the setup_intent.succeeded webhook, not here.
definePageMeta({ layout: false })

const route = useRoute()
const t = useT()
const success = computed(() => route.query.status !== 'cancelled')
const afterBooking = computed(() => route.query.booking === '1')
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4" data-cy="card-saved">
    <div class="max-w-sm text-center">
      <p v-if="afterBooking" class="text-[17px] font-semibold text-ink-900">{{ t('Your booking is confirmed', 'Tu cita está reservada') }}</p>
      <p class="text-[15px] font-medium text-ink-900" :class="{ 'mt-2': afterBooking }">{{ success ? t('Card saved', 'Tarjeta guardada') : t('Card not saved', 'Tarjeta no guardada') }}</p>
      <p class="mt-1.5 text-[13px] text-ink-muted2">
        <template v-if="success">{{ t('Thanks -- your card has been saved. You can close this window now.', 'Gracias, tu tarjeta ha quedado guardada. Ya puedes cerrar esta ventana.') }}</template>
        <template v-else-if="afterBooking">{{ t('Your booking stands. The clinic may ask you for a card at your visit.', 'Tu cita sigue en pie. La clínica puede pedirte la tarjeta en la consulta.') }}</template>
        <template v-else>{{ t("No card was saved. You can close this window and try the link again if you'd like to add one.", 'No se ha guardado ninguna tarjeta. Puedes cerrar esta ventana y volver a abrir el enlace si quieres añadirla.') }}</template>
      </p>
    </div>
  </div>
</template>
