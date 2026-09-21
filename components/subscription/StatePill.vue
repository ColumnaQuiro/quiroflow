<script setup lang="ts">
import { type SubscriptionState } from '~/utils/billing'

// Six states, six semantic pairs, one map. Nothing else in the page decides
// what a status looks like, so a new Stripe status cannot quietly render as
// "healthy green" by falling through a v-if chain.
//
// The label always carries the meaning: colour alone never says what state
// this is, which is what keeps it readable for anyone who cannot tell the
// tints apart.
defineProps<{ state: SubscriptionState }>()

const t = useT()

const TONE: Record<SubscriptionState, 'info' | 'success' | 'danger' | 'dangerFilled' | 'chip' | 'brand'> = {
  trialing: 'info',
  active: 'success',
  past_due: 'danger',
  locked: 'dangerFilled',
  canceled: 'chip',
  comped: 'brand',
}
</script>

<template>
  <SubscriptionPill :tone="TONE[state]">
    <template v-if="state === 'trialing'">{{ t('Free trial', 'Prueba gratuita') }}</template>
    <template v-else-if="state === 'active'">{{ t('Active', 'Activa') }}</template>
    <template v-else-if="state === 'past_due'">{{ t('Payment failed', 'Pago rechazado') }}</template>
    <template v-else-if="state === 'locked'">{{ t('Locked', 'Bloqueada') }}</template>
    <template v-else-if="state === 'canceled'">{{ t('Canceled', 'Cancelada') }}</template>
    <template v-else>{{ t('Complimentary', 'De cortesía') }}</template>
  </SubscriptionPill>
</template>
