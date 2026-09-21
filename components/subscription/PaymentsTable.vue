<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'

export interface PaymentEntry {
  saleId: string
  date: string
  product: string
  transactionAmountCents: number
  taxAmountCents: number
  status: 'success' | 'failed' | 'pending'
  method: { brand: string; last4: string } | null
  invoiceUrl: string | null
}

const props = defineProps<{ payments: PaymentEntry[]; loading: boolean; firstChargeDate: string | null }>()
defineEmits<{ downloadAll: [] }>()

const t = useT()

const PAGE = 8
const shown = ref(PAGE)
const year = ref<number | null>(null)

const years = computed(() => [...new Set(props.payments.map((p) => new Date(p.date).getFullYear()))].sort((a, b) => b - a))
const filtered = computed(() => (year.value === null ? props.payments : props.payments.filter((p) => new Date(p.date).getFullYear() === year.value)))
const visible = computed(() => filtered.value.slice(0, shown.value))

watch(year, () => (shown.value = PAGE))
</script>

<template>
  <SubscriptionCard>
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3.5">
      <div class="flex-1">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Payments', 'Pagos') }}</h3>
        <p class="mt-1 text-[12.5px] text-ink-muted">
          {{ t(`Every charge we've made, with its invoice. Amounts include IVA.`, 'Todos los cargos, con su factura. Los importes incluyen IVA.') }}
        </p>
      </div>
      <label v-if="years.length > 1" class="flex items-center gap-2">
        <span class="sr-only">{{ t('Filter by year', 'Filtrar por año') }}</span>
        <select
          v-model="year"
          class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[13px] font-semibold text-ink-700 outline-none focus:border-brand focus:shadow-focus lg:h-8"
        >
          <option :value="null">{{ t('All years', 'Todos los años') }}</option>
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </label>
      <SubscriptionOutboundLink as="button" @click="$emit('downloadAll')">
        {{ t('Download all invoices', 'Descargar todas las facturas') }}
      </SubscriptionOutboundLink>
    </div>

    <div v-if="loading" class="mt-4 flex flex-col gap-2">
      <UiSkeleton v-for="n in 4" :key="n" class="h-10 w-full rounded-ctlSm" />
    </div>

    <SubscriptionPaymentsEmptyState v-else-if="payments.length === 0" :first-charge-date="firstChargeDate" />

    <template v-else>
      <!-- Header row, desktop only: on a phone each row is a stacked card and
           column headings would have nothing to head. -->
      <div class="mt-4 hidden gap-4 border-b border-line pb-2.5 lg:flex">
        <span class="w-[200px] text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('Date', 'Fecha') }}</span>
        <span class="flex-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('What it was for', 'Concepto') }}</span>
        <span class="w-[150px] text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('Charged', 'Cobrado') }}</span>
        <span class="w-[130px] pl-5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('Status', 'Estado') }}</span>
        <span class="w-[130px] text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{{ t('Invoice', 'Factura') }}</span>
      </div>

      <div class="mt-1">
        <SubscriptionPaymentRow
          v-for="payment in visible"
          :key="payment.saleId"
          :sale-id="payment.saleId"
          :date="payment.date"
          :product="payment.product"
          :total-cents="payment.transactionAmountCents"
          :tax-cents="payment.taxAmountCents"
          :status="payment.status"
          :method="payment.method"
          :invoice-url="payment.invoiceUrl"
        />
      </div>

      <div v-if="filtered.length > shown" class="mt-3.5 flex items-center gap-3">
        <button
          type="button"
          class="h-11 rounded-ctl border border-line-control px-3.5 text-[13px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-8"
          @click="shown += PAGE"
        >
          {{ t('Load more', 'Cargar más') }}
        </button>
        <span class="text-[12.5px] text-ink-muted">
          {{ t(`Showing ${visible.length} of ${filtered.length}`, `Mostrando ${visible.length} de ${filtered.length}`) }}
        </span>
      </div>
      <p v-else-if="filtered.length" class="mt-3.5 text-[12.5px] text-ink-muted">
        {{ t(`Showing all ${filtered.length}`, `Mostrando los ${filtered.length}`) }}<template v-if="firstChargeDate">
          · {{ t('first charge', 'primer cargo') }} {{ formatLongDate(firstChargeDate) }}</template>.
      </p>
    </template>
  </SubscriptionCard>
</template>
