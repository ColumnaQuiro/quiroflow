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
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? err?.message ?? say({ es: 'No se pudo iniciar el pago', en: 'The payment could not be started', fr: 'Le paiement n’a pas pu démarrer' })
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
    error.value = confirmError.message ?? say({ es: 'El pago no se pudo completar', en: 'The payment could not be completed', fr: 'Le paiement n’a pas pu aboutir' })
    return
  }
  emit('paid')
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-6 shadow-card">
    <div class="flex items-center justify-between">
      <span class="text-sm text-ink-700">{{ say({ es: 'Importe a pagar ahora', en: 'Amount to pay now', fr: 'Montant à payer maintenant' }) }}</span>
      <span class="text-lg font-semibold text-ink-900">{{ formatPrice(amountCents) }}</span>
    </div>

    <div v-if="loading" class="mt-6 text-sm text-ink-faint">{{ say({ es: 'Cargando…', en: 'Loading…', fr: 'Chargement…' }) }}</div>
    <form v-show="!loading" class="mt-4" @submit.prevent="submit">
      <div ref="mountEl"></div>
      <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      <UiBtn type="submit" variant="primary" class="mt-5 w-full" :disabled="submitting">
        {{ submitting ? say({ es: 'Procesando…', en: 'Processing…', fr: 'Traitement…' }) : say({ es: 'Pagar y confirmar', en: 'Pay and confirm', fr: 'Payer et confirmer' }) }}
      </UiBtn>
    </form>
  </div>
</template>
