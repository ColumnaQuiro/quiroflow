<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

// The bar above every staff screen that says where the account stands with
// billing. Four states, most urgent first:
//
//   * a failed payment;
//   * read-only -- an ended trial past its grace week, or a cancelled plan:
//     every screen still opens, nothing can be changed;
//   * the grace week -- the trial has ended, everything still works, and the
//     date it turns read-only is right there;
//   * a trial with days left.
//
// Only the last can be put away (for a day, and not in its last three days):
// the others are what costs the clinic its diary if missed.
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
const trialEndsOn = computed(() => (store.trialEndsAt ? formatLongDate(store.trialEndsAt) : ''))
const graceEndsOn = computed(() => (store.graceEndsAt ? formatLongDate(store.graceEndsAt) : ''))
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

  <div
    v-else-if="store.isReadOnly"
    class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-danger-text px-4 py-2 text-center text-sm font-medium text-danger-on touch:min-h-11"
    data-cy="read-only-banner"
  >
    <span>{{ t('Read-only account: you can see and export everything, but not create or change anything.', 'Cuenta en modo solo lectura: puedes consultar y exportar todo, pero no crear ni modificar nada.') }}</span>
    <span class="opacity-60">|</span>
    <NuxtLink v-if="store.isOwner" to="/subscription" class="underline underline-offset-2 hover:opacity-90">{{ t('Add a card to reactivate', 'Añadir tarjeta para reactivarla') }}</NuxtLink>
    <span v-else>{{ t('Ask the account owner to add a card.', 'Pide a la persona titular que añada una tarjeta.') }}</span>
  </div>

  <div
    v-else-if="store.trialEnded"
    class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-danger-text px-4 py-2 text-center text-sm font-medium text-danger-on touch:min-h-11"
    data-cy="grace-banner"
  >
    <span>
      {{
        t(
          `Your free trial ended on ${trialEndsOn}. Add a card before ${graceEndsOn} or the account becomes read-only.`,
          `Tu prueba gratuita terminó el ${trialEndsOn}. Añade una tarjeta antes del ${graceEndsOn} o la cuenta pasará a solo lectura.`,
        )
      }}
    </span>
    <span class="opacity-60">|</span>
    <NuxtLink v-if="store.isOwner" to="/subscription" class="underline underline-offset-2 hover:opacity-90">{{ t('Add a card', 'Añadir tarjeta') }}</NuxtLink>
    <span v-else>{{ t('Let the account owner know.', 'Avisa a la persona titular de la cuenta.') }}</span>
  </div>

  <div v-else-if="showTrial" class="relative flex items-center justify-center gap-2 bg-warning-accent px-10 py-2 text-sm touch:min-h-11 font-medium text-warning-on" data-cy="trial-banner">
    <span>
      {{ daysLeft === 1 ? t('1 day left in your trial', 'Queda 1 día de prueba') : t(`${daysLeft} days left in your trial`, `Quedan ${daysLeft} días de prueba`) }}
      <span class="hidden sm:inline">{{ t(`· ends ${trialEndsOn}`, `· termina el ${trialEndsOn}`) }}</span>
    </span>
    <span class="opacity-60">|</span>
    <NuxtLink to="/subscription" class="underline underline-offset-2 hover:opacity-90">{{ t('Add a card', 'Añadir tarjeta') }}</NuxtLink>
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
