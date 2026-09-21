<script setup lang="ts">
import { formatEur, formatLongDate, formatRelativeDays } from '~/utils/billing'

// The number this page exists for. It used to be a fragment of a string in
// the page header, joined to the status with five literal spaces.
//
// The amount is the one Stripe will actually take, tax included, and the line
// under it splits out the IVA -- so the headline can never be confused with
// the plan's per-month price, which lives on a different card entirely.
const props = withDefaults(
  defineProps<{
    variant: 'active' | 'trial' | 'past_due'
    totalCents: number | null
    subtotalCents?: number | null
    taxCents?: number | null
    date: string | null
    card: { brand: string; last4: string } | null
    /** past_due only. */
    retryDate?: string | null
    declineReason?: string | null
    /** Set when the figure is our own arithmetic because Stripe could not be read. */
    estimated?: boolean
  }>(),
  { subtotalCents: null, taxCents: null, retryDate: null, declineReason: null, estimated: false },
)

const emit = defineEmits<{ portal: [] }>()

const t = useT()
const { preference: lang } = useLang()

const eyebrow = computed(() =>
  props.variant === 'trial'
    ? t('First payment', 'Primer pago')
    : props.variant === 'past_due'
      ? t('Payment failed', 'Pago rechazado')
      : t('Next payment', 'Próximo pago'),
)
</script>

<template>
  <SubscriptionCard :tone="variant === 'past_due' ? 'danger' : 'default'">
    <p
      class="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
      :class="variant === 'trial' ? 'text-info-text' : variant === 'past_due' ? 'text-danger-text' : 'text-ink-muted'"
    >
      {{ eyebrow }}
    </p>

    <p
      class="mt-2.5 text-[29px] font-semibold tracking-tightTitle"
      :class="variant === 'past_due' ? 'text-danger-text' : 'text-ink-900'"
    >
      {{ totalCents === null ? '—' : formatEur(totalCents) }}
    </p>
    <p v-if="subtotalCents !== null && taxCents" class="mt-1 text-[12.5px] text-ink-muted">
      {{ formatEur(subtotalCents) }} + {{ formatEur(taxCents) }} {{ t('IVA', 'IVA') }}
    </p>
    <p v-else-if="totalCents !== null" class="mt-1 text-[12.5px] text-ink-muted">{{ t('+ IVA', '+ IVA') }}</p>
    <p v-if="estimated" class="mt-1 text-[12px] text-ink-muted">
      {{ t('Estimated — Stripe confirms the exact figure on the invoice.', 'Estimado: Stripe confirma la cifra exacta en la factura.') }}
    </p>

    <div class="my-3.5 h-px bg-line-divider" />

    <div v-if="date" class="flex items-center gap-2">
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[15px] w-[15px] shrink-0 text-ink-muted">
        <rect x="2.6" y="3.8" width="12.8" height="11" rx="2.2" stroke="currentColor" stroke-width="1.4" />
        <path d="M2.6 7.2H15.4" stroke="currentColor" stroke-width="1.4" />
        <path d="M6.2 2.4V5M11.8 2.4V5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <span class="flex-1 text-[13.5px] font-semibold text-ink-700">{{ formatLongDate(date) }}</span>
      <span class="text-[12.5px] text-ink-muted">{{ formatRelativeDays(date, lang) }}</span>
    </div>

    <div v-if="card" class="mt-2.5 flex items-center gap-2">
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[15px] w-[15px] shrink-0 text-ink-muted">
        <rect x="2.4" y="4.4" width="13.2" height="9.2" rx="2" stroke="currentColor" stroke-width="1.4" />
        <path d="M2.4 7.6h13.2" stroke="currentColor" stroke-width="1.4" />
      </svg>
      <span class="flex-1 font-mono text-[13px] capitalize text-ink-500">{{ card.brand }} ·· {{ card.last4 }}</span>
    </div>

    <!-- Trial: there is nothing to charge yet, and saying so is the point. -->
    <div v-if="variant === 'trial' && !card" class="mt-2.5 flex items-start gap-2 rounded-ctl border border-info-border bg-info-bg px-3 py-2.5">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="mt-px h-3.5 w-3.5 shrink-0 text-info-text">
        <circle cx="8" cy="8" r="5.9" stroke="currentColor" stroke-width="1.4" />
        <path d="M8 5.2v.2M8 7.4v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <p class="text-[12.5px] leading-[1.5] text-ink-700">{{ t('No card on file yet.', 'Todavía no hay tarjeta guardada.') }}</p>
    </div>

    <div v-if="variant === 'past_due'" class="mt-2.5 space-y-1.5">
      <p v-if="declineReason" class="text-[12.5px] leading-[1.5] text-ink-700">{{ declineReason }}</p>
      <p v-if="retryDate" class="text-[12.5px] text-ink-muted">
        {{ t('We try again on', 'Lo intentamos de nuevo el') }} {{ formatLongDate(retryDate) }}.
      </p>
    </div>

    <div class="mt-3.5 border-t border-line-divider pt-3">
      <button
        v-if="variant !== 'active'"
        type="button"
        class="flex h-11 w-full items-center justify-center gap-1.5 rounded-ctl text-[13.5px] font-semibold text-white outline-none focus-visible:shadow-focus lg:h-10"
        :class="variant === 'past_due' ? 'bg-danger-text' : 'bg-brand hover:bg-brand-hover'"
        @click="emit('portal')"
      >
        {{ variant === 'past_due' ? t('Update card in Stripe', 'Actualizar tarjeta en Stripe') : t('Add payment method', 'Añadir método de pago') }}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3">
          <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
      <SubscriptionOutboundLink v-else as="button" @click="emit('portal')">
        {{ t('View upcoming invoice in Stripe', 'Ver la próxima factura en Stripe') }}
      </SubscriptionOutboundLink>
    </div>
  </SubscriptionCard>
</template>
