<script setup lang="ts">
import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from '@stripe/stripe-js'

const props = defineProps<{
  accountSlug: string
  invoiceId: string
  amountCents: number
  formatPrice: (cents: number) => string
}>()
const emit = defineEmits<{ paid: [] }>()

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
    stripe = await loadStripe(publishableKey, connectAccountId ? { stripeAccount: connectAccountId } : undefined)
    if (!stripe || !mountEl.value) throw new Error('Stripe failed to load')
    elements = stripe.elements({ clientSecret })
    paymentElement = elements.create('payment')
    paymentElement.mount(mountEl.value)
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? err?.message ?? 'No se pudo iniciar el pago'
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
    error.value = confirmError.message ?? 'El pago no se pudo completar'
    return
  }
  emit('paid')
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface p-6 shadow-card">
    <div class="flex items-center justify-between">
      <span class="text-sm text-ink-700">Importe a pagar ahora</span>
      <span class="text-lg font-semibold text-ink-900">{{ formatPrice(amountCents) }}</span>
    </div>

    <div v-if="loading" class="mt-6 text-sm text-ink-faint">Cargando…</div>
    <form v-show="!loading" class="mt-4" @submit.prevent="submit">
      <div ref="mountEl"></div>
      <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      <UiBtn type="submit" variant="primary" class="mt-5 w-full" :disabled="submitting">
        {{ submitting ? 'Procesando…' : 'Pagar y confirmar' }}
      </UiBtn>
    </form>
  </div>
</template>
