<script setup lang="ts">
// Facturas emitidas, on the phone: the web's pages/reports/facturas.vue, with
// the same query, the same figures (utils/gestoriaExport.ts's ivaSummary, so
// a rectificativa counts with its negative amounts and the totals are net of
// refunds) and the same CSV (facturaBookRows, ';' and a BOM so Excel keeps
// the accents). Reshaped for a phone: the type filter is a chip beside the
// period, the nine-column table is a list -- recipient and total on the line,
// number, date, type and base/IVA under them -- showing 50 at a time, and the
// IVA-by-rate table is a short list. The CSV and each factura's PDF go to the
// share sheet (utils/shareReportFile.ts) instead of a browser download, which
// the app's WebView does not do. Left out: the PDF of the report itself (no
// report PDF on the app yet).
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { formatEur } from '../../../utils/billing'
import { DEFAULT_CLINIC_TIMEZONE } from '../../../utils/clinicClock'
import { facturaBookRows, ivaSummary, KIND_ES, type GestoriaFactura } from '../../../utils/gestoriaExport'
import { reportCsv, shareReportFile, shareReportMessage } from '~/utils/shareReportFile'

definePageMeta({ layout: 'practitioner' })

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()
const { labelFor, ensureLoaded } = usePaymentMethods()
const tz = DEFAULT_CLINIC_TIMEZONE

interface FacturaRow {
  id: string
  number: string
  kind: string
  issued_at: string
  description: string | null
  amount_cents: number
  tax_base_cents: number | null
  tax_rate_bp: number | null
  tax_amount_cents: number | null
  tax_exemption_code: string | null
  recipient_name: string | null
  recipient_nif: string | null
  rectifies_factura_id: string | null
  annulled_at: string | null
  patient_id: string
  patients: { first_name: string; last_name: string | null; national_id: string | null } | null
  payments: { method: string } | null
}

const range = ref(computePresetRange({ months: 1 }))
const rows = ref<FacturaRow[]>([])
const numberById = ref(new Map<string, string>())
const loading = ref(true)
const failed = ref(false)
const kind = ref<'' | 'full' | 'simplified' | 'rectificativa'>('')
const search = ref('')

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  try {
    const { from, to } = rangeBounds(range.value)
    const data = await fetchAllRows<FacturaRow>((f, tt) =>
      supabase
        .from('facturas')
        .select('id, number, kind, issued_at, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, recipient_name, recipient_nif, rectifies_factura_id, annulled_at, patient_id, patients(first_name, last_name, national_id), payments(method)')
        .gte('issued_at', from.toISOString())
        .lt('issued_at', to.toISOString())
        .order('issued_at', { ascending: false })
        .order('number', { ascending: false })
        .range(f, tt) as any,
    )
    await ensureLoaded()
    // The number a rectificativa corrects, when that factura is from before
    // the period.
    const known = new Map(data.map((r) => [r.id, r.number]))
    const missing = [...new Set(data.map((r) => r.rectifies_factura_id).filter((id): id is string => !!id && !known.has(id)))]
    if (missing.length) {
      const { data: more } = await supabase.from('facturas').select('id, number').in('id', missing)
      for (const r of more ?? []) known.set(r.id, r.number)
    }
    if (mine !== run) return
    rows.value = data
    numberById.value = known
  } catch {
    if (mine === run) failed.value = true
  } finally {
    if (mine === run) loading.value = false
  }
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "nothing issued".
const allowed = computed(() => !!context.value && canOpen('/reports/facturas'))
watch([allowed, range], ([ok]) => { if (ok) load() }, { immediate: true })

const recipientOf = (r: FacturaRow) => r.recipient_name || `${r.patients?.first_name ?? ''} ${r.patients?.last_name ?? ''}`.trim()
const nifOf = (r: FacturaRow) => r.recipient_nif || (r.kind === 'full' ? (r.patients?.national_id ?? '') : '')

function asGestoria(r: FacturaRow): GestoriaFactura {
  return {
    number: r.number,
    kind: r.kind,
    issued_at: r.issued_at,
    description: r.description,
    amount_cents: r.amount_cents,
    tax_base_cents: r.tax_base_cents,
    tax_rate_bp: r.tax_rate_bp,
    tax_amount_cents: r.tax_amount_cents,
    tax_exemption_code: r.tax_exemption_code,
    recipient_name: recipientOf(r) || null,
    recipient_nif: nifOf(r) || null,
    rectifies_number: r.rectifies_factura_id ? (numberById.value.get(r.rectifies_factura_id) ?? null) : null,
    payment_method: r.payments?.method ? labelFor(r.payments.method) : null,
    annulled_at: r.annulled_at,
  }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (kind.value && r.kind !== kind.value) return false
    if (!q) return true
    return [r.number, recipientOf(r), nifOf(r), r.description ?? ''].some((s) => s.toLowerCase().includes(q))
  })
})
const summary = computed(() => ivaSummary(filtered.value.map(asGestoria)))
const kindCount = (k: string) => rows.value.filter((r) => r.kind === k).length

const PAGE = 50
const limit = ref(PAGE)
watch([range, kind, search], () => { limit.value = PAGE })
const visible = computed(() => filtered.value.slice(0, limit.value))

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' })
const KIND_LABEL = computed<Record<string, string>>(() => ({ full: t('Full', 'Completa'), simplified: t('Simplified', 'Simplificada'), rectificativa: t('Corrective', 'Rectificativa') }))
const rateOf = (r: FacturaRow) => (r.tax_exemption_code ? t('Exempt', 'Exenta') : `${((r.tax_rate_bp ?? 0) / 100).toLocaleString('es-ES')} %`)
const KINDS = ['full', 'simplified', 'rectificativa'] as const
const kindOptions = computed(() => KINDS.filter((k) => kindCount(k)).map((k) => ({ id: k, name: `${KIND_LABEL.value[k]} · ${kindCount(k)}` })))

function subtitleOf(r: FacturaRow) {
  const type = KIND_LABEL.value[r.kind] ?? KIND_ES[r.kind] ?? r.kind
  const rectifies = r.rectifies_factura_id ? numberById.value.get(r.rectifies_factura_id) : null
  // Base and IVA on the detail line, not under the total: beside the PDF
  // button there is no room for them on the right of a phone.
  const tax = `${t('Base', 'Base')} ${formatEur(r.tax_base_cents ?? r.amount_cents)} · ${t('IVA', 'IVA')} ${formatEur(r.tax_amount_cents ?? 0)} ${rateOf(r)}`.trim()
  return [r.number, dateOf(r.issued_at), rectifies ? `${type} · ${rectifies}` : type, nifOf(r) || null, tax].filter(Boolean).join(' · ')
}
function valueNoteOf(r: FacturaRow) {
  // Annulled with a registro de anulación: on the series, in no total.
  return r.annulled_at ? t('annulled', 'anulada') : null
}

// The access log the web writes through useAccessLog (store-based, not here),
// written the way the app's patient record does it. Fire-and-forget.
function logExport(detail: Record<string, string | number>) {
  const accountId = context.value?.accountId
  if (!accountId) return
  supabase.rpc('log_patient_access', { p_account_id: accountId, p_kind: 'export', p_patient_id: undefined, p_detail: detail }).then(({ error }) => {
    if (error) console.warn('[access-log]', 'export', error.message)
  })
}

// A file waiting for a fresh tap. Only the app's web build gets here (see
// shareReportFile: the browser's sheet opens only within the tap that asked
// for it); in the app it opens straight away.
const shareNote = ref<string | null>(null)
const pendingShare = ref<{ blob: Blob; filename: string; mime: string; onOk?: () => void } | null>(null)
async function deliver(blob: Blob, filename: string, mime: string, onOk?: () => void) {
  const result = await shareReportFile(blob, filename, mime)
  shareNote.value = shareReportMessage(result, t)
  pendingShare.value = result.status === 'needs-tap' ? { blob, filename, mime, onOk } : null
  if (result.ok) onOk?.()
}
function sharePending() {
  const p = pendingShare.value
  if (p) deliver(p.blob, p.filename, p.mime, p.onOk)
}

function shareCsv() {
  const csv = reportCsv(facturaBookRows(filtered.value.map(asGestoria), tz), ';')
  // The BOM tells Excel it is UTF-8, so the accents survive.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const count = filtered.value.length
  deliver(blob, `facturas-emitidas-${range.value.from}-${range.value.to}.csv`, 'text/csv', () => logExport({ export: 'facturas_issued', rows: count }))
}

const pdfLoading = ref<string | null>(null)
async function sharePdf(r: FacturaRow) {
  if (pdfLoading.value) return
  pdfLoading.value = r.id
  shareNote.value = null
  try {
    // The server logs the PDF as opened itself (invoice_pdf), as on the web.
    const blob = await authedFetch<Blob>(`/api/facturas/${r.id}/pdf`, { responseType: 'blob' })
    await deliver(blob, `${r.number}.pdf`, 'application/pdf')
  } catch (e: any) {
    shareNote.value = e?.data?.statusMessage ?? t("Couldn't load the factura's PDF.", 'No se ha podido cargar el PDF de la factura.')
  } finally {
    pdfLoading.value = null
  }
}
</script>

<template>
  <ReportScreen :title="t('Issued facturas', 'Facturas emitidas')" path="/reports/facturas" :description="t('Every factura issued in the period, with its IVA', 'Todas las facturas emitidas en el periodo, con su IVA')">
    <template #actions>
      <button
        type="button"
        class="-mr-1 flex h-11 shrink-0 items-center gap-1 px-2 text-[15px] font-semibold text-brand-text disabled:opacity-40"
        :disabled="loading || !filtered.length"
        :aria-label="t('Share CSV', 'Compartir CSV')"
        data-cy="report-facturas-csv"
        @click="shareCsv"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 10V2M5 4.8 8 2l3 2.8M3.5 7.5v6h9v-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        CSV
      </button>
    </template>
    <template #filters>
      <ReportRangePicker v-model="range" />
      <ReportSelect v-model="kind" :options="kindOptions" :all-label="t(`All · ${rows.length}`, `Todas · ${rows.length}`)" :label="t('Type', 'Tipo')" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('The report could not be loaded.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <div v-if="shareNote" class="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink-700" role="status" data-cy="report-facturas-share-note">
      <span class="min-w-0 flex-1">{{ shareNote }}</span>
      <AppButton v-if="pendingShare" variant="primary" @click="sharePending">{{ t('Share', 'Compartir') }}</AppButton>
    </div>

    <div class="grid grid-cols-2 gap-3" data-cy="report-facturas-stats">
      <ReportsStat :label="t('Facturas', 'Facturas')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-facturas-count">{{ summary.total.count }}</p>
        <p v-if="kindCount('rectificativa')" class="text-[12px] text-ink-muted">{{ t(`${kindCount('rectificativa')} corrective`, `${kindCount('rectificativa')} rectificativas`) }}</p>
      </ReportsStat>
      <ReportsStat :label="t('Tax base', 'Base imponible')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-facturas-base">{{ formatEur(summary.total.baseCents) }}</p>
      </ReportsStat>
      <ReportsStat :label="t('IVA', 'IVA')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-facturas-iva">{{ formatEur(summary.total.cuotaCents) }}</p>
      </ReportsStat>
      <ReportsStat :label="t('Total', 'Total')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-facturas-total">{{ formatEur(summary.total.totalCents) }}</p>
        <p class="text-[12px] text-ink-muted">{{ t('net of corrective facturas', 'descontadas las rectificativas') }}</p>
      </ReportsStat>
    </div>

    <ReportsModule v-if="summary.lines.length > 1" :title="t('By IVA rate', 'Por tipo de IVA')" :loading="loading" skeleton="list" :rows="3">
      <ul class="mt-1" data-cy="report-facturas-iva-lines">
        <ReportRow
          v-for="l in summary.lines"
          :key="l.key"
          :title="l.label"
          :subtitle="`${l.count} factura(s) · ${t('Base', 'Base')} ${formatEur(l.baseCents)} · ${t('IVA', 'IVA')} ${formatEur(l.cuotaCents)}`"
          :value="formatEur(l.totalCents)"
        />
      </ul>
    </ReportsModule>

    <ReportsModule :title="t('Facturas', 'Facturas')" :loading="loading" skeleton="list" :rows="8">
      <input
        v-model="search"
        type="search"
        :placeholder="t('Number, name, NIF…', 'Número, nombre, NIF…')"
        class="mt-2 h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none"
        data-cy="report-facturas-search"
      />
      <p v-if="!filtered.length" class="py-4 text-center text-[13.5px] text-ink-faint" data-cy="report-facturas-empty">{{ t('No facturas in this period.', 'No hay facturas en este periodo.') }}</p>
      <template v-else>
        <ul class="mt-1" data-cy="report-facturas-list">
          <ReportRow
            v-for="r in visible"
            :key="r.id"
            :to="`/patients/${r.patient_id}`"
            :title="shown(recipientOf(r) || '—')"
            :subtitle="subtitleOf(r)"
            :value="formatEur(r.amount_cents)"
            :value-note="valueNoteOf(r)"
            :tone="r.annulled_at ? 'muted' : 'default'"
            :data-kind="r.kind"
            data-cy="report-facturas-row"
          >
            <template #trailing>
              <!-- Inside the row's link: prevent stops the link from following the tap. -->
              <button
                type="button"
                class="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control px-2 text-[12.5px] font-semibold text-brand-text disabled:opacity-50"
                :disabled="pdfLoading !== null"
                :aria-label="t(`PDF of ${r.number}`, `PDF de ${r.number}`)"
                data-cy="report-facturas-pdf"
                @click.stop.prevent="sharePdf(r)"
              >
                {{ pdfLoading === r.id ? '…' : 'PDF' }}
              </button>
            </template>
          </ReportRow>
        </ul>
        <AppButton v-if="filtered.length > limit" variant="quiet" class="mt-1 w-full" data-cy="report-facturas-more" @click="limit += PAGE">
          {{ t(`Show more (${filtered.length - limit})`, `Ver más (${filtered.length - limit})`) }}
        </AppButton>
      </template>
    </ReportsModule>
  </ReportScreen>
</template>
