<script setup lang="ts">
import { loadStripe, type Stripe, type StripeElements, type StripePaymentElement } from '@stripe/stripe-js'

const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const t = useT()

// A modal dialog: focus stays inside it, Escape closes it, and focus goes
// back to whatever opened it (useFocusTrap).
const dialogPanel = ref<HTMLElement | null>(null)
const dialogTitleId = useId()
useFocusTrap(dialogPanel, () => emit('close'))

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
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
    <div ref="dialogPanel" role="dialog" aria-modal="true" :aria-labelledby="dialogTitleId" class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card bg-surface p-6 shadow-popover">
      <div class="flex items-center justify-between">
        <h2 :id="dialogTitleId" class="text-lg font-semibold text-ink-900">{{ t('Add card', 'Añadir tarjeta') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600 -m-2 p-2 touch:-m-3 touch:p-3" @click="emit('close')">✕</button>
      </div>

      <UiSkeleton v-if="loading" class="mt-6 h-9 w-full rounded-ctl" />
      <form v-show="!loading" class="mt-4" @submit.prevent="submit">
        <div ref="mountEl"></div>
        <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-ctl border border-line-control px-4 py-2 text-sm text-ink-700 hover:bg-surface-subtle" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
          <button type="submit" :disabled="submitting" class="rounded-ctl bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50">
            {{ submitting ? t('Saving…', 'Guardando…') : t('Save card', 'Guardar tarjeta') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
