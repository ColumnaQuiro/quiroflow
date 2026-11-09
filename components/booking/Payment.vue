<script setup lang="ts">
// Types only at the top. Evaluating @stripe/stripe-js injects js.stripe.com's
// script (~260 KB) as a side effect, whether or not anything calls it, so a
// static import here put Stripe on every visit to the booking page -- most of
// which take no payment at all. It is imported below, once there is one.
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js'

const props = defineProps<{
  accountSlug: string
  invoiceId: string
  amountCents: number
  formatPrice: (cents: number) => string
}>()
const emit = defineEmits<{ paid: [] }>()
const { lang, say } = useBookingLang()

const loading = ref(true)
// Stripe's fields mounted. Until then, and for good if they failed to load,
// there is nothing for "Pagar y confirmar" to submit.
const ready = ref(false)
const submitting = ref(false)
const error = ref('')
const mountEl = ref<HTMLElement | null>(null)

let stripe: Stripe | null = null
let elements: StripeElements | null = null
let paymentElement: StripePaymentElement | null = null

onMounted(async () => {
  try {
    const { clientSecret, publishableKey, connectAccountId } = await $fetch<{
      clientSecret: string
      publishableKey: string
      connectAccountId: string | null
    }>('/api/public-booking/create-payment-intent', { method: 'POST', body: { accountSlug: props.accountSlug, invoiceId: props.invoiceId } })
    const { loadStripe } = await import('@stripe/stripe-js')
    stripe = await loadStripe(publishableKey, connectAccountId ? { stripeAccount: connectAccountId } : undefined)
    if (!stripe || !mountEl.value) throw new Error('Stripe failed to load')
    // Stripe's own fields and messages in the page's language too.
    elements = stripe.elements({ clientSecret, locale: lang.value })
    paymentElement = elements.create('payment')
    paymentElement.mount(mountEl.value)
    ready.value = true
  } catch (err: any) {
    // create-payment-intent's refusals are English sentences for a developer
    // ("Invoice not found"), and Stripe failing to load is no better. The
    // booking already exists whatever went wrong here, so the patient is told
    // that, and who can take the payment instead.
    error.value =
      err?.data?.statusMessage === 'This invoice is already settled.'
        ? say({ es: 'Esta reserva ya está pagada.', en: 'This booking has already been paid.', fr: 'Cette réservation est déjà payée.' })
        : say({
            es: 'No se ha podido abrir el pago. Su cita sigue reservada: llame a la clínica para pagarla de otra forma.',
            en: 'The payment could not be opened. Your appointment is still booked: please call the clinic to pay another way.',
            fr: 'Le paiement n’a pas pu s’ouvrir. Votre rendez-vous reste réservé : appelez le cabinet pour payer autrement.',
          })
  } finally {
    loading.value = false
  }
})

async function submit() {
  if (!stripe || !elements) return
  error.value = ''
  submitting.value = true
  const { error: confirmError } = await stripe.confirmPayment({ elements, redirect: 'if_required' })
  submitting.value = false
  if (confirmError) {
    // Stripe's own message is already in the page's language (locale above).
    error.value = confirmError.message ?? say({ es: 'No se ha podido completar el pago. Revise los datos de la tarjeta o pruebe con otra.', en: 'The payment could not be completed. Check the card details or try another card.', fr: 'Le paiement n’a pas pu aboutir. Vérifiez les données de la carte ou essayez-en une autre.' })
    return
  }
  emit('paid')
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-6 shadow-card">
    <div class="flex items-center justify-between">
      <span class="text-sm text-ink-700">{{ say({ es: 'Importe a pagar ahora', en: 'Amount to pay now', fr: 'Montant à payer maintenant' }) }}</span>
      <span class="font-mono text-lg font-semibold text-ink-900">{{ formatPrice(amountCents) }}</span>
    </div>

    <!-- Roughly the card form Stripe is about to draw, so the panel does not
         sit empty under a line of grey text while its script loads. -->
    <div v-if="loading" class="mt-4 space-y-3" role="status">
      <span class="sr-only">{{ say({ es: 'Cargando…', en: 'Loading…', fr: 'Chargement…' }) }}</span>
      <UiSkeleton class="h-11 rounded-ctl" />
      <div class="grid grid-cols-2 gap-3">
        <UiSkeleton class="h-11 rounded-ctl" />
        <UiSkeleton class="h-11 rounded-ctl" />
      </div>
      <UiSkeleton class="mt-2 h-9 rounded-ctl touch:h-11" />
    </div>
    <form v-show="!loading" class="mt-4" @submit.prevent="submit">
      <div ref="mountEl"></div>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      <!-- The appointment is booked before this step and stays booked
           whether or not it is paid (create_public_booking), so the button
           says what it does: pay, not "confirm". -->
      <UiBtn v-if="ready" type="submit" variant="primary" class="mt-5 w-full" :disabled="submitting">
        {{ submitting ? say({ es: 'Procesando el pago…', en: 'Processing payment…', fr: 'Paiement en cours…' }) : say({ es: `Pagar ${formatPrice(amountCents)}`, en: `Pay ${formatPrice(amountCents)}`, fr: `Payer ${formatPrice(amountCents)}` }) }}
      </UiBtn>
    </form>
  </div>
</template>
