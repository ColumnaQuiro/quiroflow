<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { quarterBounds, type IvaLine } from '~/utils/gestoriaExport'

// Informes > Gestoría: a quarter (or a month) of facturas for the clinic's
// accountant, in one download -- the libro registro de facturas expedidas,
// the IVA summary by rate (exempt services next to products at 21/10/4 %),
// the money in by payment method, and optionally every factura's PDF.
// The figures on screen are the ZIP's (server/api/reports/gestoria-export).
const t = useT()
const authedFetch = useAuthedFetch()
const { labelFor, ensureLoaded } = usePaymentMethods()

const now = new Date()
const year = ref(now.getFullYear())
const quarter = ref<number | null>(Math.floor(now.getMonth() / 3) + 1)
const month = ref('')

const range = computed(() => {
  if (month.value) {
    const [y, m] = month.value.split('-').map(Number)
    return { from: `${month.value}-01`, to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) }
  }
  return quarterBounds(year.value, quarter.value ?? 1)
})
const periodLabel = computed(() => (month.value ? new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${t('Q', 'T')}${quarter.value} ${year.value}`))

interface Preview { count: number; iva: { lines: IvaLine[]; total: IvaLine }; byMethod: { method: string; count: number; cents: number }[]; pdfParts: number }
const preview = ref<Preview | null>(null)
const loading = ref(false)
const error = ref('')
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  error.value = ''
  try {
    const p = await authedFetch<Preview>('/api/reports/gestoria-export', { method: 'POST', body: { ...range.value, preview: true } })
    if (mine === run) preview.value = p
  } catch (e: any) {
    if (mine === run) error.value = e?.data?.statusMessage ?? t("Couldn't load the period.", 'No se ha podido cargar el periodo.')
  } finally {
    if (mine === run) loading.value = false
  }
}
onMounted(() => {
  ensureLoaded()
  load()
})
watch(range, load)
function pickQuarter(q: number) {
  month.value = ''
  quarter.value = q
}

// The book and summaries in one ZIP; the PDFs in parts (each made within
// one request), one button per part.
const downloading = ref<'book' | number | null>(null)
async function download(part: number | null = null) {
  downloading.value = part ?? 'book'
  error.value = ''
  try {
    const r = await authedFetch<{ url: string }>('/api/reports/gestoria-export', { method: 'POST', body: { ...range.value, ...(part !== null ? { pdfPart: part } : {}) } })
    window.location.href = r.url
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't make the download.", 'No se ha podido preparar la descarga.')
  } finally {
    downloading.value = null
  }
}
const th = 'px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted'
const td = 'border-t border-line-row px-3 py-2.5 text-[13.5px] text-ink-900'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Accountant', 'Gestoría')" :meta="t('Facturas and IVA for the quarter, in one download', 'Facturas e IVA del trimestre, en una descarga')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>
    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="gestoria" :data-ready="loading ? undefined : 'true'">
      <div class="mx-auto flex max-w-[860px] flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <select v-model.number="year" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900" :aria-label="t('Year', 'Año')" data-cy="gestoria-year">
            <option v-for="y in [now.getFullYear() - 1, now.getFullYear()]" :key="y" :value="y">{{ y }}</option>
          </select>
          <UiBtn v-for="q in [1, 2, 3, 4]" :key="q" size="sm" :variant="!month && quarter === q ? 'primary' : 'secondary'" :data-cy="`gestoria-q${q}`" @click="pickQuarter(q)">{{ t('Q', 'T') }}{{ q }}</UiBtn>
          <span class="text-[13px] text-ink-muted">{{ t('or a month', 'o un mes') }}</span>
          <input v-model="month" type="month" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900" :aria-label="t('Month', 'Mes')" data-cy="gestoria-month" />
        </div>

        <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

        <section class="overflow-hidden rounded-card border border-line bg-surface">
          <div class="flex items-baseline justify-between px-4 pt-3.5">
            <h2 class="text-[15px] font-bold capitalize text-ink-900">{{ periodLabel }}</h2>
            <span class="text-[13px] text-ink-muted" data-cy="gestoria-count">{{ preview?.count ?? 0 }} {{ t('facturas', 'facturas') }}</span>
          </div>
          <table class="mt-2 w-full border-collapse" data-cy="gestoria-iva">
            <thead><tr><th :class="th">{{ t('IVA', 'IVA') }}</th><th :class="th" class="text-right">{{ t('Facturas', 'Facturas') }}</th><th :class="th" class="text-right">{{ t('Base', 'Base imponible') }}</th><th :class="th" class="text-right">{{ t('IVA', 'Cuota IVA') }}</th><th :class="th" class="text-right">{{ t('Total', 'Total') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in preview?.iva.lines ?? []" :key="l.key" data-cy="gestoria-iva-line" :data-key="l.key">
                <td :class="td">{{ l.label }}</td>
                <td :class="td" class="text-right font-mono">{{ l.count }}</td>
                <td :class="td" class="text-right font-mono">{{ formatEur(l.baseCents) }}</td>
                <td :class="td" class="text-right font-mono">{{ formatEur(l.cuotaCents) }}</td>
                <td :class="td" class="text-right font-mono">{{ formatEur(l.totalCents) }}</td>
              </tr>
              <tr v-if="preview && preview.iva.lines.length" class="bg-surface-subtle font-semibold">
                <td :class="td">{{ t('Total', 'Total') }}</td>
                <td :class="td" class="text-right font-mono">{{ preview.iva.total.count }}</td>
                <td :class="td" class="text-right font-mono">{{ formatEur(preview.iva.total.baseCents) }}</td>
                <td :class="td" class="text-right font-mono" data-cy="gestoria-iva-total">{{ formatEur(preview.iva.total.cuotaCents) }}</td>
                <td :class="td" class="text-right font-mono">{{ formatEur(preview.iva.total.totalCents) }}</td>
              </tr>
              <tr v-if="preview && !preview.iva.lines.length"><td :class="td" colspan="5" class="text-ink-muted">{{ t('No facturas in this period.', 'No hay facturas en este periodo.') }}</td></tr>
            </tbody>
          </table>
          <p class="border-t border-line-row px-4 py-2.5 text-[12px] text-ink-muted">{{ t('Net of rectificativas (refunds), which go in with negative amounts.', 'Neto de rectificativas (devoluciones), que entran con importes negativos.') }}</p>
        </section>

        <section v-if="preview?.byMethod.length" class="rounded-card border border-line bg-surface px-4 py-3" data-cy="gestoria-methods">
          <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Money in by method', 'Cobros por forma de pago') }}</h2>
          <div v-for="m in preview.byMethod" :key="m.method" class="flex justify-between border-b border-line-divider py-2 text-[13.5px] last:border-b-0">
            <span>{{ labelFor(m.method) }} <span class="text-ink-muted">· {{ m.count }}</span></span><span class="font-mono">{{ formatEur(m.cents) }}</span>
          </div>
        </section>

        <section class="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5">
          <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Download for the accountant', 'Descargar para la gestoría') }}</h2>
          <p class="text-[13px] text-ink-muted">{{ t('A ZIP with the facturas book (libro registro de facturas expedidas), the IVA summary and the payments, as CSV files that open in Excel; and, if they want them, the facturas themselves as PDF.', 'Un ZIP con el libro registro de facturas expedidas, el resumen de IVA y los cobros, en CSV que se abren en Excel; y, si las quieren, las facturas en PDF.') }}</p>
          <UiBtn variant="primary" class="self-start" :disabled="downloading !== null || !preview?.count" data-cy="gestoria-download" @click="download()">{{ downloading === 'book' ? t('Preparing…', 'Preparando…') : t('Download ZIP', 'Descargar ZIP') }}</UiBtn>
          <div v-if="preview?.pdfParts" class="flex flex-wrap items-center gap-2 border-t border-line-divider pt-2.5">
            <span class="text-[13px] text-ink-700">{{ t('The facturas as PDF', 'Las facturas en PDF') }}<template v-if="preview.pdfParts > 1"> · {{ t(`in ${preview.pdfParts} parts`, `en ${preview.pdfParts} partes`) }}</template></span>
            <UiBtn v-for="n in preview.pdfParts" :key="n" size="sm" :disabled="downloading !== null" :data-cy="`gestoria-pdfs-${n}`" @click="download(n - 1)">{{ downloading === n - 1 ? t('Preparing…', 'Preparando…') : preview.pdfParts > 1 ? t(`Part ${n}`, `Parte ${n}`) : t('Download PDFs', 'Descargar PDF') }}</UiBtn>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
