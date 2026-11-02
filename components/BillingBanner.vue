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

// The trial banner sits above every screen, so it can be put away for a day
// -- at 200% zoom it was one of six rows above the first Inbox conversation.
// Not in the last three days, and never the failed payment: those are the
// ones that cost the clinic access if missed.
const trialHidden = useCookie<boolean>('qf_trial_banner_hidden', { maxAge: 60 * 60 * 24, default: () => false })
const showTrial = computed(() => daysLeft.value !== null && store.trialAwaitingCard && (daysLeft.value <= 3 || !trialHidden.value))
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
  <div v-else-if="showTrial" class="relative flex items-center justify-center gap-2 bg-warning-accent px-10 py-2 text-sm touch:min-h-11 font-medium text-warning-on" data-cy="trial-banner">
    <span>{{ daysLeft === 0 ? t('Trial ends today', 'La prueba termina hoy') : daysLeft === 1 ? t('1 day left in your trial', 'Queda 1 día de prueba') : t(`${daysLeft} days left in your trial`, `Quedan ${daysLeft} días de prueba`) }}</span>
    <span class="opacity-60">|</span>
    <NuxtLink to="/subscription" class="underline underline-offset-2 hover:opacity-90">{{ t('Upgrade now', 'Elegir plan') }}</NuxtLink>
    <button
      v-if="(daysLeft ?? 0) > 3"
      type="button"
      class="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-ctlSm opacity-75 hover:opacity-100 touch:h-11 touch:w-11"
      :aria-label="t('Hide for a day', 'Ocultar un día')"
      :title="t('Hide for a day', 'Ocultar un día')"
      data-cy="trial-banner-hide"
      @click="trialHidden = true"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
    </button>
  </div>
</template>
