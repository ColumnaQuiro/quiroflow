<script setup lang="ts">
import Papa from 'papaparse'
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import { DEFAULT_CLINIC_TIMEZONE } from '~/utils/clinicClock'
import { facturaBookRows, ivaSummary, KIND_ES, type GestoriaFactura } from '~/utils/gestoriaExport'

// Reports › Facturas emitidas: every factura issued in a period, on screen --
// number, date, recipient, base, IVA and total -- with the totals and the IVA
// by rate above, and the list as a CSV. Gestoría is the quarter's ZIP for the
// accountant; this is the clinic's own look at what it has issued, for any
// range, searchable, each one opening its PDF.
//
// The figures are utils/gestoriaExport.ts's, the same as the Gestoría page and
// its ZIP: a rectificativa counts with its negative amounts, so the totals are
// net of refunds. The CSV is the same libro registro (facturaBookRows).
//
// A factura's recipient is frozen on it when it was full (recipient_name);
// a simplified one leaves it null and reads the patient, as the PDF does.

const supabase = useSupabaseClient()
const t = useT()
const { labelFor, ensureLoaded } = usePaymentMethods()
const logAccess = useAccessLog()
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
watch(range, load, { immediate: true })

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

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' })
const KIND_LABEL = computed<Record<string, string>>(() => ({ full: t('Full', 'Completa'), simplified: t('Simplified', 'Simplificada'), rectificativa: t('Corrective', 'Rectificativa') }))
const rateOf = (r: FacturaRow) => (r.tax_exemption_code ? t('Exempt', 'Exenta') : `${((r.tax_rate_bp ?? 0) / 100).toLocaleString('es-ES')} %`)

function downloadCsv() {
  const csv = Papa.unparse(facturaBookRows(filtered.value.map(asGestoria), tz), { delimiter: ';' })
  // The BOM tells Excel it is UTF-8, so the accents survive.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `facturas-emitidas-${range.value.from}-${range.value.to}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  logAccess('export', null, { export: 'facturas_issued', rows: filtered.value.length })
}

const pdfRoot = ref<HTMLElement | null>(null)
const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted'
const td = 'px-3 py-2 text-[13px] text-ink-700 whitespace-nowrap'
const KINDS = ['full', 'simplified', 'rectificativa'] as const
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Issued facturas', 'Facturas emitidas')" :meta="t('Every factura issued in the period, with its IVA', 'Todas las facturas emitidas en el periodo, con su IVA')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Issued facturas', 'Facturas emitidas')" :range="range" :practitioner-id="null" :clinic-id="null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="facturas-report" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <UiBtn variant="secondary" size="sm" :disabled="loading || !filtered.length" data-pdf-skip data-cy="facturas-csv" @click="downloadCsv">{{ t('Download CSV', 'Descargar CSV') }}</UiBtn>
      </div>

      <p v-if="failed" class="mt-4 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[13.5px] text-danger-text">
        {{ t('The report could not be loaded.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-2 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ReportsStat :label="t('Facturas', 'Facturas')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="facturas-count">{{ summary.total.count }}</p>
          <p v-if="kindCount('rectificativa')" class="text-[12px] text-ink-faint2">{{ t(`${kindCount('rectificativa')} corrective`, `${kindCount('rectificativa')} rectificativas`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Tax base', 'Base imponible')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="facturas-base">{{ formatEur(summary.total.baseCents) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('IVA', 'IVA')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="facturas-iva">{{ formatEur(summary.total.cuotaCents) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Total', 'Total')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="facturas-total">{{ formatEur(summary.total.totalCents) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('net of corrective facturas', 'descontadas las rectificativas') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule v-if="summary.lines.length > 1" class="mt-4" :title="t('By IVA rate', 'Por tipo de IVA')" :loading="loading" skeleton="list" :rows="3">
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[480px]" data-cy="facturas-iva-lines">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th :class="th">{{ t('Rate', 'Tipo') }}</th>
                <th :class="th">{{ t('Facturas', 'Facturas') }}</th>
                <th :class="th">{{ t('Base', 'Base') }}</th>
                <th :class="th">{{ t('IVA', 'IVA') }}</th>
                <th :class="th">{{ t('Total', 'Total') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="l in summary.lines" :key="l.key">
                <td :class="td">{{ l.label }}</td>
                <td :class="td">{{ l.count }}</td>
                <td :class="td">{{ formatEur(l.baseCents) }}</td>
                <td :class="td">{{ formatEur(l.cuotaCents) }}</td>
                <td :class="td">{{ formatEur(l.totalCents) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>

      <ReportsModule class="mt-4" :title="t('Facturas', 'Facturas')" :loading="loading" skeleton="list" :rows="8">
        <div class="mt-2 flex flex-wrap items-center gap-1.5" data-pdf-skip>
          <button
            type="button"
            class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-10"
            :class="!kind ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'"
            :aria-pressed="!kind"
            @click="kind = ''"
          >
            {{ t(`All · ${rows.length}`, `Todas · ${rows.length}`) }}
          </button>
          <template v-for="k in KINDS" :key="k">
            <button
              v-if="kindCount(k)"
              type="button"
              class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-10"
              :class="kind === k ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'"
              :aria-pressed="kind === k"
              :data-cy="`facturas-kind-${k}`"
              @click="kind = k"
            >
              {{ KIND_LABEL[k] }} · {{ kindCount(k) }}
            </button>
          </template>
          <input
            v-model="search"
            type="search"
            :placeholder="t('Number, name, NIF…', 'Número, nombre, NIF…')"
            class="ml-auto h-8 w-56 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-10"
            data-cy="facturas-search"
          />
        </div>

        <p v-if="!filtered.length" class="mt-4 text-[13px] text-ink-muted" data-cy="facturas-empty">{{ t('No facturas in this period.', 'No hay facturas en este periodo.') }}</p>
        <div v-else class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[860px]">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th :class="th">{{ t('Number', 'Número') }}</th>
                <th :class="th">{{ t('Date', 'Fecha') }}</th>
                <th :class="th">{{ t('Type', 'Tipo') }}</th>
                <th :class="th">{{ t('Recipient', 'Destinatario') }}</th>
                <th :class="th">NIF</th>
                <th :class="th">{{ t('Base', 'Base') }}</th>
                <th :class="th">{{ t('IVA', 'IVA') }}</th>
                <th :class="th">{{ t('Total', 'Total') }}</th>
                <th :class="th" data-pdf-skip />
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="r in filtered" :key="r.id" data-cy="facturas-row" :data-kind="r.kind">
                <td :class="td" class="font-mono">{{ r.number }}</td>
                <td :class="td">{{ dateOf(r.issued_at) }}</td>
                <td :class="td">
                  {{ KIND_LABEL[r.kind] ?? KIND_ES[r.kind] ?? r.kind }}
                  <span v-if="r.rectifies_factura_id && numberById.get(r.rectifies_factura_id)" class="text-ink-muted"> · {{ numberById.get(r.rectifies_factura_id) }}</span>
                  <!-- Annulled with a registro de anulación: on the series, in no total. -->
                  <span v-if="r.annulled_at" data-cy="facturas-row-annulled" class="ml-1 rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-[11px] text-chip-text">{{ t('annulled', 'anulada') }}</span>
                </td>
                <td :class="td" class="max-w-[220px] truncate">
                  <NuxtLink :to="`/patients/${r.patient_id}?tab=billing`" class="hover:underline">{{ recipientOf(r) || '—' }}</NuxtLink>
                </td>
                <td :class="td" class="font-mono">{{ nifOf(r) }}</td>
                <td :class="[td, r.annulled_at && 'line-through text-ink-faint']" class="font-mono">{{ formatEur(r.tax_base_cents ?? r.amount_cents) }}</td>
                <td :class="[td, r.annulled_at && 'line-through text-ink-faint']" class="font-mono">{{ formatEur(r.tax_amount_cents ?? 0) }} <span class="text-ink-muted">{{ rateOf(r) }}</span></td>
                <td :class="[td, r.annulled_at ? 'line-through text-ink-faint' : 'text-ink-900']" class="font-mono font-semibold">{{ formatEur(r.amount_cents) }}</td>
                <td :class="td" data-pdf-skip>
                  <a :href="`/api/facturas/${r.id}/pdf`" target="_blank" rel="noopener" class="text-[12.5px] font-medium text-brand-text hover:underline">PDF</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>
    </div>
  </div>
</template>
