<script setup lang="ts">
// Gestoría, on the phone: the web's pages/reports/gestoria.vue -- a quarter
// (or a month) of facturas for the clinic's accountant. The figures are the
// same server preview (/api/reports/gestoria-export with preview: true) the
// web shows, so they are the ZIP's. Reshaped for a phone: year, quarter and
// month are chips in the filter row; the IVA table is a list of rates with a
// total row; the downloads are buttons. The web sends the browser to the
// ZIP's signed link; inside the app that link would only leave the app, so
// the file is fetched and handed to the share sheet (utils/shareReportFile.ts)
// -- save to Files or mail it to the gestoría straight from there.
import { formatEur } from '../../../utils/billing'
import { quarterBounds, type IvaLine } from '../../../utils/gestoriaExport'
import { shareReportFile, shareReportMessage } from '~/utils/shareReportFile'

definePageMeta({ layout: 'practitioner' })

const t = useT()
const authedFetch = useAuthedFetch()
const { canOpen, context } = useReportAccess()
const { labelFor, ensureLoaded } = usePaymentMethods()

const now = new Date()
const year = ref(now.getFullYear())
const quarter = ref<number | null>(Math.floor(now.getMonth() / 3) + 1)
const month = ref('')
const yearOptions = [now.getFullYear() - 1, now.getFullYear()].map((y) => ({ id: String(y), name: String(y) }))
const yearModel = computed({ get: () => String(year.value), set: (v: string) => { if (v) year.value = Number(v) } })

const range = computed(() => {
  if (month.value) {
    const [y, m] = month.value.split('-').map(Number)
    return { from: `${month.value}-01`, to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10) }
  }
  return quarterBounds(year.value, quarter.value ?? 1)
})
const periodLabel = computed(() => (month.value ? new Date(`${month.value}-15T12:00:00Z`).toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${t('Q', 'T')}${quarter.value} ${year.value}`))
// The web capitalises it with CSS; a module title is plain text.
const periodTitle = computed(() => periodLabel.value.charAt(0).toUpperCase() + periodLabel.value.slice(1))

interface Preview { count: number; iva: { lines: IvaLine[]; total: IvaLine }; byMethod: { method: string; count: number; cents: number }[]; pdfParts: number }
const preview = ref<Preview | null>(null)
const loading = ref(true)
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
    if (mine === run) {
      preview.value = null
      error.value = e?.data?.statusMessage ?? t("Couldn't load the period.", 'No se ha podido cargar el periodo.')
    }
  } finally {
    if (mine === run) loading.value = false
  }
}
// Only once the role is known to include it.
const allowed = computed(() => !!context.value && canOpen('/reports/gestoria'))
watch([allowed, range], ([ok]) => {
  if (!ok) return
  ensureLoaded()
  load()
}, { immediate: true })
function pickQuarter(q: number) {
  month.value = ''
  quarter.value = q
}

// A file waiting for a fresh tap. Only the app's web build gets here (see
// shareReportFile: the browser's sheet opens only within the tap that asked
// for it, and fetching the ZIP outlives it); in the app it opens straight
// away.
const shareNote = ref<string | null>(null)
const pendingShare = ref<{ blob: Blob; filename: string; mime: string } | null>(null)
async function deliver(blob: Blob, filename: string, mime: string) {
  const result = await shareReportFile(blob, filename, mime)
  shareNote.value = shareReportMessage(result, t)
  pendingShare.value = result.status === 'needs-tap' ? { blob, filename, mime } : null
}
function sharePending() {
  const p = pendingShare.value
  if (p) deliver(p.blob, p.filename, p.mime)
}

// The book and summaries in one ZIP; the PDFs in parts (each made within
// one request), one button per part.
const downloading = ref<'book' | number | null>(null)
async function download(part: number | null = null) {
  downloading.value = part ?? 'book'
  error.value = ''
  shareNote.value = null
  pendingShare.value = null
  try {
    const r = await authedFetch<{ url: string; fileName?: string }>('/api/reports/gestoria-export', { method: 'POST', body: { ...range.value, ...(part !== null ? { pdfPart: part } : {}) } })
    const res = await fetch(r.url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const filename = r.fileName || `gestoria-${range.value.from}-${range.value.to}${part !== null ? `-pdf-${part + 1}` : ''}.zip`
    await deliver(blob, filename, 'application/zip')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't make the download.", 'No se ha podido preparar la descarga.')
  } finally {
    downloading.value = null
  }
}

const chip = (on: boolean) => ['flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-semibold', on ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700']
</script>

<template>
  <ReportScreen :title="t('Accountant', 'Gestoría')" path="/reports/gestoria" :description="t('Facturas and IVA for the quarter, in one download', 'Facturas e IVA del trimestre, en una descarga')">
    <template #filters>
      <ReportSelect v-model="yearModel" :options="yearOptions" :label="t('Year', 'Año')" data-cy="report-gestoria-year" />
      <button v-for="q in [1, 2, 3, 4]" :key="q" type="button" :class="chip(!month && quarter === q)" :aria-pressed="!month && quarter === q" :data-cy="`report-gestoria-q${q}`" @click="pickQuarter(q)">{{ t('Q', 'T') }}{{ q }}</button>
      <!-- A month instead: the native month picker laid over the chip. -->
      <label class="relative" :class="chip(!!month)">
        <span class="whitespace-nowrap capitalize">{{ month ? periodLabel : t('A month', 'Un mes') }}</span>
        <AppChevron dir="down" :size="14" class="ml-1 opacity-70" />
        <input v-model="month" type="month" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" :aria-label="t('Month', 'Mes')" data-cy="report-gestoria-month" />
      </label>
    </template>

    <p v-if="error" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ error }}
      <button v-if="!preview" type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <div v-if="shareNote" class="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink-700" role="status" data-cy="report-gestoria-share-note">
      <span class="min-w-0 flex-1">{{ shareNote }}</span>
      <AppButton v-if="pendingShare" variant="primary" @click="sharePending">{{ t('Share', 'Compartir') }}</AppButton>
    </div>

    <ReportsModule :title="periodTitle" :loading="loading" skeleton="list" :rows="4">
      <p class="text-[12.5px] text-ink-muted" data-cy="report-gestoria-count">{{ preview?.count ?? 0 }} {{ t('facturas', 'facturas') }}</p>
      <p v-if="!preview?.iva.lines.length" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No facturas in this period.', 'No hay facturas en este periodo.') }}</p>
      <ul v-else class="mt-1" data-cy="report-gestoria-iva">
        <ReportRow
          v-for="l in preview.iva.lines"
          :key="l.key"
          :title="l.label"
          :subtitle="`${l.count} factura(s) · ${t('Base', 'Base imponible')} ${formatEur(l.baseCents)} · ${t('IVA', 'Cuota IVA')} ${formatEur(l.cuotaCents)}`"
          :value="formatEur(l.totalCents)"
          :data-key="l.key"
          data-cy="report-gestoria-iva-line"
        />
        <ReportRow
          :title="t('Total', 'Total')"
          :subtitle="`${preview.iva.total.count} factura(s) · ${t('Base', 'Base imponible')} ${formatEur(preview.iva.total.baseCents)}`"
          :value="formatEur(preview.iva.total.totalCents)"
          :value-note="`${t('IVA', 'Cuota IVA')} ${formatEur(preview.iva.total.cuotaCents)}`"
          class="font-semibold"
          data-cy="report-gestoria-iva-total"
        />
      </ul>
      <p class="mt-2 text-[12px] text-ink-muted">{{ t('Net of rectificativas (refunds), which go in with negative amounts.', 'Neto de rectificativas (devoluciones), que entran con importes negativos.') }}</p>
    </ReportsModule>

    <ReportsModule v-if="preview?.byMethod.length" :title="t('Money in by method', 'Cobros por forma de pago')" :loading="loading" skeleton="list" :rows="3">
      <ul class="mt-1" data-cy="report-gestoria-methods">
        <ReportRow v-for="m in preview.byMethod" :key="m.method" :title="labelFor(m.method)" :subtitle="`${m.count}`" :value="formatEur(m.cents)" />
      </ul>
    </ReportsModule>

    <section class="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5">
      <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Download for the accountant', 'Descargar para la gestoría') }}</h2>
      <p class="text-[13px] text-ink-muted">{{ t('A ZIP with the facturas book (libro registro de facturas expedidas), the IVA summary and the payments, as CSV files that open in Excel; and, if they want them, the facturas themselves as PDF.', 'Un ZIP con el libro registro de facturas expedidas, el resumen de IVA y los cobros, en CSV que se abren en Excel; y, si las quieren, las facturas en PDF.') }}</p>
      <AppButton variant="primary" :disabled="downloading !== null || !preview?.count" data-cy="report-gestoria-download" @click="download()">{{ downloading === 'book' ? t('Preparing…', 'Preparando…') : t('Download ZIP', 'Descargar ZIP') }}</AppButton>
      <div v-if="preview?.pdfParts" class="flex flex-col gap-2 border-t border-line-divider pt-2.5">
        <span class="text-[13px] text-ink-700">{{ t('The facturas as PDF', 'Las facturas en PDF') }}<template v-if="preview.pdfParts > 1"> · {{ t(`in ${preview.pdfParts} parts`, `en ${preview.pdfParts} partes`) }}</template></span>
        <div class="grid grid-cols-2 gap-2">
          <AppButton v-for="n in preview.pdfParts" :key="n" :disabled="downloading !== null" :data-cy="`report-gestoria-pdfs-${n}`" @click="download(n - 1)">{{ downloading === n - 1 ? t('Preparing…', 'Preparando…') : preview.pdfParts > 1 ? t(`Part ${n}`, `Parte ${n}`) : t('Download PDFs', 'Descargar PDF') }}</AppButton>
        </div>
      </div>
    </section>
  </ReportScreen>
</template>
