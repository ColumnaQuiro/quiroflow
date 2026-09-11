<script setup lang="ts">
// The patient's invoices. Was web-portal-only; the mobile app showed a
// balance with nothing behind it, so a patient could see they owed money
// and not what for.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const t = useT()

interface InvoiceRow {
  id: string
  invoice_number: string | null
  total_cents: number
  status: string
  created_at: string
}

const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)
const showAll = ref(false)

// Enough to cover a year of visits without pulling a decade of history onto
// a phone; "show all" lifts it.
const PREVIEW = 8

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, total_cents, status, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
    .limit(200)
  invoices.value = data ?? []
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

const visible = computed(() => (showAll.value ? invoices.value : invoices.value.slice(0, PREVIEW)))

const statusChip: Record<string, string> = {
  paid: 'bg-success-bg text-success-text',
  unpaid: 'bg-danger-bg text-danger-text',
  void: 'bg-chip-bg text-chip-text',
}
const statusLabel: Record<string, [string, string]> = {
  paid: ['Paid', 'Pagada'],
  unpaid: ['Unpaid', 'Pendiente'],
  void: ['Void', 'Anulada'],
}
</script>

<template>
  <section>
    <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Invoices', 'Facturas') }}</h2>
    <div class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div v-if="loading" class="p-4 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <ul v-else-if="invoices.length > 0" class="divide-y divide-line">
        <li v-for="inv in visible" :key="inv.id" class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="text-[13.5px] font-medium text-ink-900">€{{ (inv.total_cents / 100).toFixed(2) }}</p>
            <p class="text-[12px] text-ink-faint">
              {{ new Date(inv.created_at).toLocaleDateString() }}
              <template v-if="inv.invoice_number"> &middot; {{ inv.invoice_number }}</template>
            </p>
          </div>
          <span class="shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-medium" :class="statusChip[inv.status] ?? 'bg-chip-bg text-chip-text'">
            {{ t(statusLabel[inv.status]?.[0] ?? inv.status, statusLabel[inv.status]?.[1] ?? inv.status) }}
          </span>
        </li>
      </ul>
      <p v-else class="p-4 text-center text-[13px] text-ink-faint">{{ t('No invoices yet.', 'Todavía no hay facturas.') }}</p>
    </div>
    <button
      v-if="!showAll && invoices.length > PREVIEW"
      type="button"
      class="mt-2 text-[12.5px] font-medium text-ink-muted hover:text-ink-700"
      @click="showAll = true"
    >
      {{ t(`Show all ${invoices.length}`, `Ver las ${invoices.length}`) }}
    </button>
  </section>
</template>
