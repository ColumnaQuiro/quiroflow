<script setup lang="ts">
import { formatEur, formatLongDate } from '~/utils/billing'

// One charge. The amount shown is the total Stripe took, IVA INCLUDED -- the
// old table put "Transaction Amount" and "Tax Amount" in adjacent columns,
// which read as though the tax were added on top of the number beside it.
//
// The Stripe id is the only thing here a clinic never needs, so it lives
// inside the expanded row rather than being the first column.
const props = defineProps<{
  saleId: string
  date: string
  product: string
  totalCents: number
  taxCents: number
  status: 'success' | 'failed' | 'pending'
  method: { brand: string; last4: string } | null
  invoiceUrl: string | null
  /** e.g. "Card declined — insufficient funds. Retried successfully on 24 July." */
  note?: string | null
  refunded?: boolean
}>()

const t = useT()
const open = ref(false)
const copied = ref(false)

const baseCents = computed(() => props.totalCents - props.taxCents)
const rowId = computed(() => `payment-${props.saleId}`)

async function copyReference() {
  try {
    await navigator.clipboard.writeText(props.saleId)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard blocked -- the id is selectable on screen either way.
  }
}
</script>

<template>
  <div>
    <!-- The expand control and the invoice link are siblings, not nested: an
         <a> inside a <button> is invalid, and the browser picks one of them at
         random when you click. That is why the PDF link was missing entirely
         from the row the first time this was built. -->
    <div class="flex items-start gap-4 border-b border-line-divider">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-start gap-4 py-3.5 text-left outline-none focus-visible:bg-surface-subtle"
        :aria-expanded="open"
        :aria-controls="rowId"
        @click="open = !open"
      >
        <span class="w-[130px] shrink-0 text-[13px] text-ink-500 lg:w-[200px]">{{ formatLongDate(date) }}</span>
        <span class="min-w-0 flex-1">
          <span class="block text-[13.5px] text-ink-900">{{ product }}</span>
          <span v-if="note" class="mt-[3px] block text-[12px] text-ink-muted">{{ note }}</span>
          <!-- The status has no column of its own on a phone, so it rides
               under the description rather than disappearing. -->
          <span class="mt-1.5 flex lg:hidden">
            <SubscriptionPill :tone="refunded ? 'chip' : status === 'success' ? 'success' : status === 'failed' ? 'danger' : 'chip'">
              {{ refunded ? t('Refunded', 'Reembolsado') : status === 'success' ? t('Paid', 'Pagada') : status === 'failed' ? t('Failed', 'Fallida') : t('Pending', 'Pendiente') }}
            </SubscriptionPill>
          </span>
        </span>
        <span
          class="w-[110px] shrink-0 text-right font-mono text-[13.5px] font-medium lg:w-[150px]"
          :class="status === 'failed' ? 'text-danger-text' : refunded ? 'text-ink-muted' : 'text-ink-900'"
        >{{ refunded ? '−' : '' }}{{ formatEur(Math.abs(totalCents)) }}</span>
        <span class="hidden w-[130px] shrink-0 pl-5 lg:flex">
          <SubscriptionPill :tone="refunded ? 'chip' : status === 'success' ? 'success' : status === 'failed' ? 'danger' : 'chip'">
            {{ refunded ? t('Refunded', 'Reembolsado') : status === 'success' ? t('Paid', 'Pagada') : status === 'failed' ? t('Failed', 'Fallida') : t('Pending', 'Pendiente') }}
          </SubscriptionPill>
        </span>
      </button>
      <span class="hidden w-[130px] shrink-0 justify-end py-3.5 lg:flex">
        <SubscriptionOutboundLink v-if="invoiceUrl" :href="invoiceUrl">{{ t('Invoice PDF', 'Factura PDF') }}</SubscriptionOutboundLink>
        <span v-else class="text-[12.5px] text-ink-faint">—</span>
      </span>
    </div>

    <div v-if="open" :id="rowId" class="mb-3.5 flex flex-col gap-6 rounded-[9px] border border-line bg-surface-subtle px-4 py-3.5 lg:flex-row lg:gap-7">
      <div class="lg:w-[300px]">
        <p class="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {{ t('What made up this charge', 'De qué se compone este cargo') }}
        </p>
        <div class="mt-2.5 flex justify-between">
          <span class="text-[12.5px] text-ink-500">{{ product }}</span>
          <span class="font-mono text-[12.5px] text-ink-900">{{ formatEur(baseCents) }}</span>
        </div>
        <div class="mt-1.5 flex justify-between">
          <span class="text-[12.5px] text-ink-500">{{ t('IVA', 'IVA') }}</span>
          <span class="font-mono text-[12.5px] text-ink-900">{{ formatEur(taxCents) }}</span>
        </div>
        <div class="mt-2 flex justify-between border-t border-line pt-2">
          <span class="text-[12.5px] font-semibold text-ink-900">{{ t('Total charged', 'Total cobrado') }}</span>
          <span class="font-mono text-[13px] font-semibold text-ink-900">{{ formatEur(totalCents) }}</span>
        </div>
      </div>

      <div class="flex-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('Paid with', 'Pagado con') }}</p>
        <p class="mt-2.5 font-mono text-[12.5px] capitalize text-ink-700">
          {{ method ? `${method.brand} ·· ${method.last4}` : t('—', '—') }}
        </p>
        <p class="mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {{ t('Reference, only needed if you write to support', 'Referencia, solo si escribes a soporte') }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span class="rounded-[6px] border border-chip-border bg-chip-bg px-2 py-1 font-mono text-[12px] text-ink-muted">{{ saleId }}</span>
          <button
            type="button"
            class="h-[26px] rounded-[6px] border border-line-control px-2.5 text-[12px] font-semibold text-ink-700 outline-none hover:bg-surface focus-visible:shadow-focus"
            @click.stop="copyReference"
          >
            {{ copied ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
