<script setup lang="ts">
// Where Stripe's card page sends the patient back: from the "Card link" staff
// send, or straight after an online booking when the clinic asks for a card
// (?booking=1, server/api/public-booking/book.post.ts), or from "Añadir
// tarjeta" in the patient app (?app=1, server/api/portal/card-link.post.ts),
// which opened it in the phone's browser. The card itself is
// recorded by the setup_intent.succeeded webhook, not here.
definePageMeta({ layout: false })

const route = useRoute()
const t = useT()
const success = computed(() => route.query.status !== 'cancelled')
const afterBooking = computed(() => route.query.booking === '1')
const fromApp = computed(() => route.query.app === '1')
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4 py-10" data-cy="card-saved">
    <!-- After a booking the booking is the news, and the card the footnote:
         the title says it is made, the line under it what became of the card. -->
    <BookingResult
      :tone="afterBooking || success ? 'success' : 'neutral'"
      :title="afterBooking ? t('Your booking is confirmed', 'Su cita está reservada') : success ? t('Card saved', 'Tarjeta guardada') : t('Card not saved', 'Tarjeta no guardada')"
    >
      <p v-if="afterBooking" class="font-medium text-ink-900">{{ success ? t('Card saved', 'Tarjeta guardada') : t('Card not saved', 'Tarjeta no guardada') }}</p>
      <p :class="{ 'mt-1': afterBooking }">
        <template v-if="success && fromApp">{{ t('Thanks -- your card has been saved. Go back to the app to use it.', 'Gracias, tu tarjeta ha quedado guardada. Vuelve a la app para usarla.') }}</template>
        <template v-else-if="success">{{ t('Thanks -- your card has been saved. You can close this window now.', 'Gracias, su tarjeta ha quedado guardada. Ya puede cerrar esta ventana.') }}</template>
        <template v-else-if="fromApp">{{ t('No card was saved. Go back to the app to try again.', 'No se ha guardado ninguna tarjeta. Vuelve a la app para intentarlo de nuevo.') }}</template>
        <template v-else-if="afterBooking">{{ t('Your booking stands. The clinic may ask you for a card at your visit.', 'Su cita sigue reservada. La clínica puede pedirle la tarjeta en la consulta.') }}</template>
        <template v-else>{{ t("No card was saved. You can close this window and try the link again if you'd like to add one.", 'No se ha guardado ninguna tarjeta. Puede cerrar esta ventana y volver a abrir el enlace si quiere añadirla.') }}</template>
      </p>
    </BookingResult>
  </div>
</template>
