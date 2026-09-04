<script setup lang="ts">
import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from '@stripe/stripe-js'

const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const t = useT()

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
    error.value = err?.data?.statusMessage ?? err?.message ?? t('Could not start card setup', 'No se pudo iniciar la configuración de la tarjeta')
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
    error.value = confirmError.message ?? t('Card could not be saved', 'No se pudo guardar la tarjeta')
    submitting.value = false
    return
  }
  const paymentMethodId = typeof setupIntent?.payment_method === 'string' ? setupIntent.payment_method : setupIntent?.payment_method?.id
  if (!paymentMethodId) {
    error.value = t('Card could not be saved', 'No se pudo guardar la tarjeta')
    submitting.value = false
    return
  }
  await useStaffFetch('/api/stripe/save-payment-method', { method: 'POST', body: { patientId: props.patientId, paymentMethodId } })
  submitting.value = false
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">{{ t('Add card', 'Añadir tarjeta') }}</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <UiSkeleton v-if="loading" class="mt-6 h-9 w-full rounded-md" />
      <form v-show="!loading" class="mt-4" @submit.prevent="submit">
        <div ref="mountEl"></div>
        <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
          <button type="submit" :disabled="submitting" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ submitting ? t('Saving…', 'Guardando…') : t('Save card', 'Guardar tarjeta') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
