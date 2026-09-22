<script setup lang="ts">
const store = useAccountStore()
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
  <div v-if="isPastDue" class="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white">
    <span>Your last payment failed. Update your payment method to avoid losing access.</span>
    <span class="opacity-60">|</span>
    <button type="button" class="underline underline-offset-2 hover:opacity-90 disabled:opacity-60" :disabled="loadingPortal" @click="openPortal()">
      {{ loadingPortal ? 'Opening…' : 'Update payment method' }}
    </button>
    <template v-if="portalError">
      <span class="opacity-60">|</span>
      <a :href="upgradeHref" class="underline underline-offset-2 hover:opacity-90">Email us</a>
    </template>
  </div>
  <div v-else-if="daysLeft !== null" class="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
    <span>{{ daysLeft === 0 ? 'Trial ends today' : daysLeft === 1 ? '1 day left in your trial' : `${daysLeft} days left in your trial` }}</span>
    <span class="opacity-60">|</span>
    <NuxtLink to="/subscription" class="underline underline-offset-2 hover:opacity-90">Upgrade now</NuxtLink>
  </div>
</template>
