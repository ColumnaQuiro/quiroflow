<script setup lang="ts">
const store = useAccountStore()
const t = useT()
const daysLeft = computed(() => store.trialDaysLeft)
const isPastDue = computed(() => store.subscriptionStatus === 'past_due')
const { loading: loadingPortal, error: portalError, openPortal } = useBillingPortal()

// Offered beside the button rather than navigated to behind it: this used to
// be where a failed portal call silently sent the browser, which is how
// "Update payment method" came to open a mail client instead of Stripe.
const upgradeHref = computed(() => {
  const subject = encodeURIComponent(`Upgrade my QuiroFlow plan -- ${store.accountName}`)
  return `mailto:hola@quiroflow.com?subject=${subject}`
})
</script>

<template>
  <div v-if="isPastDue" class="flex items-center justify-center gap-2 bg-danger-text px-4 py-2 text-sm font-medium text-danger-on">
    <span>{{ t('Your last payment failed. Update your payment method to avoid losing access.', 'El último pago ha fallado. Actualiza el método de pago para no perder el acceso.') }}</span>
    <span class="opacity-60">|</span>
    <button type="button" class="underline underline-offset-2 hover:opacity-90 disabled:opacity-60" :disabled="loadingPortal" @click="openPortal()">
      {{ loadingPortal ? t('Opening…', 'Abriendo…') : t('Update payment method', 'Actualizar método de pago') }}
    </button>
    <template v-if="portalError">
      <span class="opacity-60">|</span>
      <a :href="upgradeHref" class="underline underline-offset-2 hover:opacity-90">{{ t('Email us', 'Escríbenos') }}</a>
    </template>
  </div>
  <div v-else-if="daysLeft !== null && store.trialAwaitingCard" class="flex items-center justify-center gap-2 bg-warning-accent px-4 py-2 text-sm font-medium text-warning-on">
    <span>{{ daysLeft === 0 ? t('Trial ends today', 'La prueba termina hoy') : daysLeft === 1 ? t('1 day left in your trial', 'Queda 1 día de prueba') : t(`${daysLeft} days left in your trial`, `Quedan ${daysLeft} días de prueba`) }}</span>
    <span class="opacity-60">|</span>
    <NuxtLink to="/subscription" class="underline underline-offset-2 hover:opacity-90">{{ t('Upgrade now', 'Elegir plan') }}</NuxtLink>
  </div>
</template>
