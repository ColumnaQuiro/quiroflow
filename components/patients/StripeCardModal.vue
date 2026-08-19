<script setup lang="ts">
import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from '@stripe/stripe-js'

const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()

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
    }>('/api/stripe/setup-intent', { method: 'POST', body: { patientId: props.patientId } })
    stripe = await loadStripe(publishableKey, connectAccountId ? { stripeAccount: connectAccountId } : undefined)
    if (!stripe || !mountEl.value) throw new Error('Stripe failed to load')
    elements = stripe.elements({ clientSecret })
    paymentElement = elements.create('payment')
    paymentElement.mount(mountEl.value)
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? err?.message ?? 'Could not start card setup'
  } finally {
    loading.value = false
  }
})

async function submit() {
  if (!stripe || !elements) return
  error.value = ''
  submitting.value = true
  const { error: confirmError, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' })
  if (confirmError) {
    error.value = confirmError.message ?? 'Card could not be saved'
    submitting.value = false
    return
  }
  const paymentMethodId = typeof setupIntent?.payment_method === 'string' ? setupIntent.payment_method : setupIntent?.payment_method?.id
  if (!paymentMethodId) {
    error.value = 'Card could not be saved'
    submitting.value = false
    return
  }
  await $fetch('/api/stripe/save-payment-method', { method: 'POST', body: { patientId: props.patientId, paymentMethodId } })
  submitting.value = false
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">Add card</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
      <form v-show="!loading" class="mt-4" @submit.prevent="submit">
        <div ref="mountEl"></div>
        <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">Cancel</button>
          <button type="submit" :disabled="submitting" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ submitting ? 'Saving…' : 'Save card' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
