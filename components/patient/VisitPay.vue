<script setup lang="ts">
import { formatEur } from '../../utils/billing'
import type { AppPaymentsCard, AppPaymentsVisit } from '../../composables/useAppPayments'

// "Pagar" on one visit in the patient app: ahead of a booked visit, or for
// the one just had -- or "Pagada" once it is. Nothing at all when the clinic
// does not take payments from the app, or the visit is not one to pay here
// (a bono covers it, it is free). See composables/useAppPayments.ts.
const props = defineProps<{ pay: AppPaymentsVisit | null; card: AppPaymentsCard | null; busy: boolean; upcoming: boolean }>()
const emit = defineEmits<{ pay: [] }>()
const t = useT()
const amount = computed(() => formatEur(props.pay?.amountCents ?? 0))
</script>

<template>
  <span v-if="pay?.state === 'paid'" class="inline-flex items-center gap-1 rounded-pill bg-success-bg px-2.5 py-1 text-[12px] font-semibold text-success-text" data-cy="patient-visit-paid">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
    {{ t('Paid', 'Pagada') }}
  </span>
  <div v-else-if="pay?.state === 'payable'" class="flex flex-col gap-1">
    <button
      type="button"
      class="h-11 w-full rounded-ctl bg-brand px-3 text-[13.5px] font-semibold text-brand-on disabled:opacity-60"
      :disabled="busy"
      data-cy="patient-visit-pay"
      @click="emit('pay')"
    >
      <template v-if="busy">{{ t('Paying…', 'Pagando…') }}</template>
      <template v-else-if="upcoming">{{ t(`Pay now · ${amount}`, `Pagar ahora · ${amount}`) }}</template>
      <template v-else>{{ t(`Pay this visit · ${amount}`, `Pagar esta visita · ${amount}`) }}</template>
    </button>
    <p class="text-center text-[12px] text-ink-muted">
      <template v-if="card">{{ t(`With your card ···· ${card.last4}`, `Con tu tarjeta ···· ${card.last4}`) }}</template>
      <template v-else>{{ t('Opens a secure payment page', 'Se abre una página de pago segura') }}</template>
      <template v-if="upcoming"> · {{ t('refunded if you cancel', 'se devuelve si cancelas') }}</template>
    </p>
  </div>
</template>
