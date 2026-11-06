<script setup lang="ts">
import type { AppPaymentsCard } from '../../composables/useAppPayments'

// The card a patient pays their visits with from the app, and the way to add
// or replace it: Stripe's own page, opened in the browser, so the card number
// never passes through the app (server/api/portal/card-link.post.ts).
// `yours`: the card shown is the signed-in person's own, paying for a family
// member who has none saved (composables/useAppPayments.ts).
defineProps<{ card: AppPaymentsCard | null; busy: boolean; yours?: boolean }>()
const emit = defineEmits<{ add: [] }>()
const t = useT()
const BRAND: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay' }
</script>

<template>
  <div class="flex items-center gap-3" data-cy="patient-saved-card">
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>
    </span>
    <div class="min-w-0 flex-1">
      <template v-if="card">
        <p class="text-[14px] font-semibold text-ink-900">{{ BRAND[card.brand] ?? card.brand }} ···· {{ card.last4 }}</p>
        <p v-if="yours" class="text-[12px] text-ink-muted">{{ t('Your own card', 'Tu propia tarjeta') }}</p>
        <p class="text-[12px] text-ink-muted">{{ t(`Expires ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`, `Caduca ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`) }}</p>
      </template>
      <template v-else>
        <p class="text-[14px] font-semibold text-ink-900">{{ t('No card saved', 'Sin tarjeta guardada') }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('Save one to pay your visits in one tap.', 'Guárdala para pagar tus visitas con un toque.') }}</p>
      </template>
    </div>
    <button
      type="button"
      class="h-9 shrink-0 rounded-ctlSm border border-line-control px-3 text-[12.5px] font-semibold text-ink-700 disabled:opacity-60"
      :disabled="busy"
      data-cy="patient-card-add"
      @click="emit('add')"
    >
      {{ busy ? t('Opening…', 'Abriendo…') : card ? t('Change', 'Cambiar') : t('Add card', 'Añadir tarjeta') }}
    </button>
  </div>
</template>
