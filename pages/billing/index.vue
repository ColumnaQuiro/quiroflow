<script setup lang="ts">
interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
  patients: { first_name: string; last_name: string | null } | null
}

type StatusFilter = 'all' | 'unpaid' | 'paid' | 'void'

const supabase = useSupabaseClient()
const route = useRoute()
const t = useT()

const statusFilter = ref<StatusFilter>('unpaid')
const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)
const counts = ref<Record<StatusFilter, number>>({ all: 0, unpaid: 0, paid: 0, void: 0 })
const outstandingCents = ref(0)
const outstandingCount = ref(0)
const statsLoaded = ref(false)

// Carried over from the invoice detail page's "Back to billing" link so the
// row the user just came from keeps its selected treatment on return --
// doesn't affect which rows are loaded, purely cosmetic.
const highlightId = computed(() => (route.query.highlight as string) || '')

const FILTERS = computed<{ value: StatusFilter; label: string }[]>(() => [
  { value: 'unpaid', label: t('Unpaid', 'Impagadas') },
  { value: 'paid', label: t('Paid', 'Pagadas') },
  { value: 'void', label: t('Void', 'Anuladas') },
  { value: 'all', label: t('All', 'Todas') },
])

const STATUS_TONE: Record<string, 'success' | 'danger' | 'neutral'> = {
  paid: 'success',
  unpaid: 'danger',
  void: 'neutral',
}

async function load() {
  loading.value = true
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, status, total_cents, created_at, patients(first_name, last_name)')
    .order('created_at', { ascending: false })
  if (statusFilter.value !== 'all') query = query.eq('status', statusFilter.value)
  const { data } = await query
  invoices.value = (data as unknown as InvoiceRow[]) ?? []
  loading.value = false
}

async function loadCounts() {
  const { data } = await supabase.from('invoices').select('status')
  const next: Record<StatusFilter, number> = { all: 0, unpaid: 0, paid: 0, void: 0 }
  for (const row of data ?? []) {
    next.all++
    if (row.status === 'unpaid' || row.status === 'paid' || row.status === 'void') next[row.status]++
  }
  counts.value = next
}

async function loadOutstanding() {
  const { data: unpaid } = await supabase.from('invoices').select('id, total_cents').eq('status', 'unpaid')
  const rows = unpaid ?? []
  const ids = rows.map((r) => r.id)

  let paidByInvoice: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: pays } = await supabase.from('payments').select('invoice_id, amount_cents').in('invoice_id', ids)
    for (const p of pays ?? []) paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] ?? 0) + p.amount_cents
  }

  outstandingCents.value = rows.reduce((sum, r) => sum + Math.max(0, r.total_cents - (paidByInvoice[r.id] ?? 0)), 0)
  outstandingCount.value = rows.length
  statsLoaded.value = true
}

onMounted(() => {
  load()
  loadCounts()
  loadOutstanding()
})
watch(statusFilter, () => {
  load()
})

const outstandingMeta = computed(() => {
  if (!statsLoaded.value) return undefined
  const amount = Math.round(outstandingCents.value / 100).toLocaleString('en-US')
  const noun = outstandingCount.value === 1 ? t('invoice', 'factura') : t('invoices', 'facturas')
  return t(
    `€${amount} outstanding across ${outstandingCount.value} ${noun}`,
    `€${amount} pendiente en ${outstandingCount.value} ${noun}`,
  )
})

function initials(row: InvoiceRow) {
  const f = row.patients?.first_name?.[0] ?? ''
  const l = row.patients?.last_name?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Billing', 'Facturación')" :meta="outstandingMeta">
      <UiBtn variant="secondary" @click="navigateTo('/settings/services')">{{ t('Services & products', 'Servicios y productos') }}</UiBtn>
      <UiBtn variant="primary" @click="navigateTo('/billing/new')">+ {{ t('Quick invoice', 'Factura rápida') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page p-6">
      <div class="mx-auto max-w-xl">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="f in FILTERS"
            :key="f.value"
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-pill border px-3 text-[12.5px] font-medium transition-colors"
            :class="
              statusFilter === f.value
                ? 'border-brand-tintBorder bg-brand-tint text-brand-text'
                : 'border-line-control bg-surface text-ink-muted hover:border-line-controlHover'
            "
            @click="statusFilter = f.value"
          >
            {{ f.label }}
            <span class="tabular-nums" :class="statusFilter === f.value ? 'text-brand-text/70' : 'text-ink-faint2'">
              &middot; {{ counts[f.value] }}
            </span>
          </button>
        </div>

        <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <div v-if="loading" class="px-4 py-10 text-center text-[13px] text-ink-muted2">{{ t('Loading…', 'Cargando…') }}</div>
          <div v-else-if="invoices.length === 0" class="px-4 py-10 text-center text-[13px] text-ink-muted2">{{ t('No invoices yet.', 'Todavía no hay facturas.') }}</div>
          <ul v-else class="divide-y divide-line-row">
            <li
              v-for="invoice in invoices"
              :key="invoice.id"
              class="flex cursor-pointer items-center justify-between gap-3 px-4 py-3"
              :class="
                invoice.id === highlightId
                  ? 'bg-[#F7F7FE] shadow-[inset_3px_0_0_theme(colors.brand.DEFAULT)]'
                  : 'hover:bg-surface-subtle'
              "
              @click="navigateTo(`/billing/${invoice.id}`)"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[10.5px] font-semibold text-brand-text">
                  {{ initials(invoice) }}
                </span>
                <div class="min-w-0">
                  <p class="truncate text-[13.5px] font-[560] text-ink-800">
                    {{ invoice.patients?.first_name }} {{ invoice.patients?.last_name }}
                  </p>
                  <p class="mt-0.5 truncate font-mono text-[11.5px] text-ink-muted2">
                    {{ invoice.invoice_number }} &middot; {{ formatDate(invoice.created_at) }}
                  </p>
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="font-mono text-[13px] font-semibold text-ink-900">€{{ (invoice.total_cents / 100).toFixed(2) }}</span>
                <UiPill :tone="STATUS_TONE[invoice.status] ?? 'neutral'">{{ invoice.status }}</UiPill>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
