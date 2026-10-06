<script setup lang="ts">
import { formatEur } from '../../utils/billing'
import { invoiceDueCents } from '../../utils/settleInvoice'
// "Cobrar" and "Vender bono" from a patient's record (useRecordMoney: the web
// Billing tab's own steps). Cobrar lists their unpaid charges, oldest first,
// with what is still due on each; Vender bono offers the clinic's bonos at
// their price, paid in full or in part (the rest stays owed on the bono).
const props = defineProps<{ patientId: string; mode: 'pay' | 'sell' }>()
const emit = defineEmits<{ done: [message: string]; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { context } = usePractitionerContext()
const { methods, ensureLoaded, defaultMethod } = usePaymentMethods()
const { payInvoice, sellBono } = useRecordMoney({
  patientId: () => props.patientId,
  accountId: () => context.value?.accountId,
  teamMemberId: () => context.value?.teamMemberId,
})

interface UnpaidInvoice { id: string; invoice_number: string; created_at: string; total_cents: number; status: string; dueCents: number }
interface BonoTemplate { id: string; name: string; session_count: number; price_cents: number }

const tab = ref<'pay' | 'sell'>(props.mode)
const loading = ref(true)
const loadError = ref('')
const invoices = ref<UnpaidInvoice[]>([])
const bonos = ref<BonoTemplate[]>([])
const invoiceId = ref('')
const packageId = ref('')
const amount = ref('')
const method = ref('cash')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  const [inv, pays, pk] = await Promise.all([
    supabase.from('invoices').select('id, invoice_number, created_at, total_cents, status, is_refund').eq('patient_id', props.patientId).eq('status', 'unpaid').order('created_at'),
    supabase.from('payments').select('invoice_id, amount_cents').eq('patient_id', props.patientId).not('invoice_id', 'is', null),
    supabase.from('packages').select('id, name, session_count, price_cents').order('name'),
    ensureLoaded(),
  ])
  if (inv.error || pays.error || pk.error) {
    loadError.value = t('Could not load the charges.', 'No se han podido cargar los cargos.')
    loading.value = false
    return
  }
  const paid = new Map<string, number>()
  for (const p of (pays.data as { invoice_id: string; amount_cents: number }[]) ?? []) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + p.amount_cents)
  invoices.value = ((inv.data as (UnpaidInvoice & { is_refund: boolean })[]) ?? [])
    .filter((i) => !i.is_refund)
    .map((i) => ({ ...i, dueCents: invoiceDueCents(i, paid.get(i.id) ?? 0) }))
    .filter((i) => i.dueCents > 0)
  bonos.value = (pk.data as BonoTemplate[]) ?? []
  method.value = defaultMethod.value
  pickInvoice(invoices.value[0]?.id ?? '')
  loading.value = false
}
onMounted(load)

function pickInvoice(id: string) {
  invoiceId.value = id
  const i = invoices.value.find((x) => x.id === id)
  if (tab.value === 'pay') amount.value = i ? (i.dueCents / 100).toFixed(2) : ''
}
watch(packageId, (id) => {
  const b = bonos.value.find((x) => x.id === id)
  amount.value = b ? (b.price_cents / 100).toFixed(2) : ''
})
watch(tab, (v) => {
  error.value = ''
  if (v === 'pay') pickInvoice(invoiceId.value || invoices.value[0]?.id || '')
  else amount.value = packageId.value ? (bonos.value.find((x) => x.id === packageId.value)!.price_cents / 100).toFixed(2) : ''
})

const cents = computed(() => Math.round((parseFloat(String(amount.value).replace(',', '.')) || 0) * 100))
const selectedInvoice = computed(() => invoices.value.find((i) => i.id === invoiceId.value) ?? null)
const selectedBono = computed(() => bonos.value.find((b) => b.id === packageId.value) ?? null)
const dateOf = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric', timeZone: context.value?.timeZone })

async function save() {
  if (saving.value) return
  error.value = ''
  if (tab.value === 'pay') {
    if (!selectedInvoice.value || cents.value <= 0) return
    if (cents.value > selectedInvoice.value.dueCents) {
      error.value = t('That is more than is due on this charge.', 'Es más de lo pendiente en este cargo.')
      return
    }
    saving.value = true
    const problem = await payInvoice(selectedInvoice.value.id, cents.value, method.value)
    saving.value = false
    if (problem) {
      error.value = problem
      return
    }
    emit('done', t(`${formatEur(cents.value)} recorded.`, `${formatEur(cents.value)} registrados.`))
    return
  }
  if (!selectedBono.value) return
  if (cents.value > selectedBono.value.price_cents) {
    error.value = t('That is more than the bono costs.', 'Es más de lo que cuesta el bono.')
    return
  }
  saving.value = true
  const { error: problem, sold } = await sellBono(selectedBono.value.id, cents.value, method.value)
  saving.value = false
  if (!sold) {
    error.value = problem ?? ''
    return
  }
  // Sold, but the payment was refused: reception has to know before the
  // patient leaves (the bono's price is owed on it).
  if (problem) {
    emit('done', t(`Bono sold, but the payment was not recorded: ${problem}`, `Bono vendido, pero el pago no se ha registrado: ${problem}`))
    return
  }
  emit('done', t(`${selectedBono.value.name} sold.`, `${selectedBono.value.name} vendido.`))
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-ink-900/40 md:items-center md:justify-center" data-cy="record-money-sheet" @click.self="emit('close')">
    <div
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="tab === 'pay' ? t('Take payment', 'Cobrar') : t('Sell a bono', 'Vender bono')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <div role="tablist" class="grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px]">
        <button v-for="k in (['pay', 'sell'] as const)" :key="k" type="button" role="tab" :aria-selected="tab === k" class="h-9 rounded-ctlSm text-[13.5px] font-semibold" :class="tab === k ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`money-tab-${k}`" @click="tab = k">
          {{ k === 'pay' ? t('Take payment', 'Cobrar') : t('Sell a bono', 'Vender bono') }}
        </button>
      </div>

      <template v-if="loading">
        <UiSkeleton class="h-12 rounded-card" />
        <UiSkeleton class="h-12 rounded-card" />
      </template>
      <p v-else-if="loadError" class="text-[13.5px] text-danger-text">{{ loadError }}</p>

      <template v-else-if="tab === 'pay'">
        <p v-if="!invoices.length" class="rounded-card border border-line bg-surface-page px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="money-nothing-due">{{ t('Nothing unpaid. Up to date.', 'No hay nada pendiente. Al día.') }}</p>
        <div v-else class="flex flex-col gap-1.5" role="radiogroup" :aria-label="t('Charge', 'Cargo')">
          <button
            v-for="i in invoices"
            :key="i.id"
            type="button"
            role="radio"
            :aria-checked="invoiceId === i.id"
            class="flex min-h-12 items-center justify-between gap-3 rounded-card px-3.5 py-2 text-left"
            :class="invoiceId === i.id ? 'border-[1.5px] border-brand bg-brand-tint' : 'border border-line-control bg-surface'"
            data-cy="money-invoice"
            @click="pickInvoice(i.id)"
          >
            <span class="min-w-0">
              <span class="block truncate font-mono text-[13px] text-ink-900">{{ i.invoice_number }}</span>
              <span class="block text-[12px] text-ink-muted">{{ dateOf(i.created_at) }}</span>
            </span>
            <span class="shrink-0 text-[14px] font-semibold text-danger-text">{{ formatEur(i.dueCents) }}</span>
          </button>
        </div>
      </template>

      <template v-else>
        <p v-if="!bonos.length" class="rounded-card border border-line bg-surface-page px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('No bonos set up. They are created on the web, in Settings.', 'No hay bonos creados. Se crean en la web, en Ajustes.') }}</p>
        <label v-else class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('Bono', 'Bono') }}
          <select v-model="packageId" class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="money-bono">
            <option value="" disabled>{{ t('Choose a bono', 'Elige un bono') }}</option>
            <option v-for="b in bonos" :key="b.id" :value="b.id">{{ b.name }} · {{ b.session_count }} · {{ formatEur(b.price_cents) }}</option>
          </select>
        </label>
      </template>

      <template v-if="!loading && !loadError && (tab === 'pay' ? !!selectedInvoice : !!selectedBono)">
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
            {{ t('Amount (€)', 'Importe (€)') }}
            <input v-model="amount" type="text" inputmode="decimal" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[16px] text-ink-900 focus:border-brand focus:outline-none" data-cy="money-amount" />
          </label>
          <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
            {{ t('Method', 'Método') }}
            <select v-model="method" class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="money-method">
              <option v-for="m in methods" :key="m.key" :value="m.key">{{ m.name }}</option>
            </select>
          </label>
        </div>
        <p v-if="tab === 'sell' && selectedBono && cents < selectedBono.price_cents" class="-mt-1 text-[12px] text-ink-muted">
          {{ t(`${formatEur(selectedBono.price_cents - cents)} stays owed on the bono.`, `Quedan ${formatEur(selectedBono.price_cents - cents)} pendientes en el bono.`) }}
        </p>
      </template>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button
        type="button"
        class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50"
        :disabled="saving || (tab === 'pay' ? !selectedInvoice || cents <= 0 : !selectedBono)"
        data-cy="money-save"
        @click="save"
      >
        <template v-if="saving">{{ t('Saving…', 'Guardando…') }}</template>
        <template v-else-if="tab === 'pay'">{{ t(`Record ${formatEur(cents)}`, `Registrar ${formatEur(cents)}`) }}</template>
        <template v-else>{{ cents > 0 ? t(`Sell and record ${formatEur(cents)}`, `Vender y registrar ${formatEur(cents)}`) : t('Sell without payment now', 'Vender sin cobrar ahora') }}</template>
      </button>
      <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </div>
  </div>
</template>
