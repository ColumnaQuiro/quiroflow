<script setup lang="ts">
import { computePresetRange, rangeBounds } from '~/composables/useDateRangePresets'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import { isRecallRule, recallReport, RECALL_WINDOW_DAYS, type RecallBooking, type RecallPatient, type RecallReply, type RecallRule, type RecallSend, type RecallStatus } from '~/utils/recallReport'

// Reports › Recalls: what the recall automations brought back
// (docs/recall-automation-plan.md). Per rule, the patients reached in the
// period and how many replied, booked, came or asked not to be contacted,
// each within 30 days of the first message (utils/recallReport.ts); then
// every one of those patients, so the desk can call whoever replied and did
// not book. The rules default to the recall ones (isRecallRule); any other
// rule that messaged patients can be added.
//
// A message is a WhatsApp or an email the rule sent (whatsapp_messages and
// email_messages carry rule_id). A reply is any WhatsApp from them after it;
// a booking is any visit created after it that was not cancelled, whoever
// made it. "Value" is each booked visit's type price, an estimate, not money
// taken.

const supabase = useSupabaseClient()
const t = useT()

const range = ref(computePresetRange({ months: 1 }))
const loading = ref(true)
const failed = ref(false)
const rules = ref<RecallRule[]>([])
const sends = ref<RecallSend[]>([])
const replies = ref<RecallReply[]>([])
const bookings = ref<RecallBooking[]>([])
const patients = ref<RecallPatient[]>([])
const picked = ref<Set<string> | null>(null)

function chunk<T>(list: T[], size = 200): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))
}

let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  try {
    const { from, to } = rangeBounds(range.value)
    // Replies and bookings can come up to 30 days after the last message.
    const until = new Date(to.getTime() + RECALL_WINDOW_DAYS * 86_400_000)
    const [ruleRows, waRows, emailRows] = await Promise.all([
      supabase.from('automation_rules').select('id, name, trigger_event, entry_mode').order('name'),
      fetchAllRows<{ rule_id: string; patient_id: string; created_at: string }>((f, tt) =>
        supabase.from('whatsapp_messages').select('rule_id, patient_id, created_at').eq('direction', 'outbound').not('rule_id', 'is', null).not('patient_id', 'is', null).gte('created_at', from.toISOString()).lte('created_at', to.toISOString()).neq('status', 'failed').order('created_at').range(f, tt),
      ),
      fetchAllRows<{ rule_id: string; patient_id: string; sent_at: string }>((f, tt) =>
        supabase.from('email_messages').select('rule_id, patient_id, sent_at').not('rule_id', 'is', null).not('patient_id', 'is', null).eq('dry_run', false).is('failed_at', null).gte('sent_at', from.toISOString()).lte('sent_at', to.toISOString()).order('sent_at').range(f, tt),
      ),
    ])
    if (ruleRows.error) throw ruleRows.error
    const allSends: RecallSend[] = [
      ...waRows.map((r) => ({ rule_id: r.rule_id, patient_id: r.patient_id, at: r.created_at })),
      ...emailRows.map((r) => ({ rule_id: r.rule_id, patient_id: r.patient_id, at: r.sent_at })),
    ]
    const ids = [...new Set(allSends.map((s) => s.patient_id))]
    const parts = await Promise.all(
      chunk(ids).map(async (some) => {
        const [r, b, p] = await Promise.all([
          supabase.from('whatsapp_messages').select('patient_id, created_at').eq('direction', 'inbound').in('patient_id', some).gte('created_at', from.toISOString()).lte('created_at', until.toISOString()),
          supabase.from('appointments').select('patient_id, created_at, starts_at, status, source, appointment_types(default_price_cents)').in('patient_id', some).is('deleted_at', null).gte('created_at', from.toISOString()).lte('created_at', until.toISOString()),
          supabase.from('patients').select('id, first_name, last_name, do_not_contact').in('id', some),
        ])
        if (r.error || b.error || p.error) throw r.error ?? b.error ?? p.error
        return { r: r.data ?? [], b: b.data ?? [], p: p.data ?? [] }
      }),
    )
    if (mine !== run) return
    rules.value = (ruleRows.data as RecallRule[] | null) ?? []
    sends.value = allSends
    replies.value = parts.flatMap((x) => x.r.map((m) => ({ patient_id: m.patient_id!, at: m.created_at })))
    bookings.value = parts.flatMap((x) =>
      x.b.map((a) => ({
        patient_id: a.patient_id!,
        created_at: a.created_at,
        starts_at: a.starts_at,
        status: a.status,
        source: a.source ?? null,
        price_cents: (a.appointment_types as { default_price_cents: number | null } | null)?.default_price_cents ?? null,
      })),
    )
    patients.value = parts.flatMap((x) => x.p as RecallPatient[])
  } catch (e) {
    console.error('[recalls report]', e)
    if (mine === run) failed.value = true
  } finally {
    if (mine === run) loading.value = false
  }
}
onMounted(load)
watch(range, load, { deep: true })

// The rules that messaged anyone in the period; the recall ones picked
// unless somebody chose otherwise.
const ruleOptions = computed(() => {
  const sent = new Set(sends.value.map((s) => s.rule_id))
  return rules.value.filter((r) => sent.has(r.id))
})
const chosen = computed(() => picked.value ?? new Set(ruleOptions.value.filter(isRecallRule).map((r) => r.id)))
function toggleRule(id: string) {
  const next = new Set(chosen.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}

const report = computed(() =>
  recallReport({
    rules: rules.value.filter((r) => chosen.value.has(r.id)),
    sends: sends.value,
    replies: replies.value,
    bookings: bookings.value,
    patients: patients.value,
  }),
)

const STATUS: Record<RecallStatus, { en: string; es: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  booked: { en: 'Booked', es: 'Reservó', tone: 'success' },
  replied: { en: 'Replied, not booked', es: 'Respondió, sin reservar', tone: 'warning' },
  opted_out: { en: 'Do not contact', es: 'No contactar', tone: 'danger' },
  waiting: { en: 'No reply yet', es: 'Aún sin respuesta', tone: 'info' },
  no_reply: { en: 'No reply', es: 'Sin respuesta', tone: 'neutral' },
}
const statusFilter = ref<RecallStatus | ''>('')
const shownRows = computed(() => report.value.rows.filter((r) => !statusFilter.value || r.status === statusFilter.value))
const countOf = (s: RecallStatus) => report.value.rows.filter((r) => r.status === s).length
const ruleName = (id: string) => rules.value.find((r) => r.id === id)?.name ?? '—'

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const pdfRoot = ref<HTMLElement | null>(null)
const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2'
const td = 'px-3 py-2 font-mono text-[13px] text-ink-800'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Recalls', 'Recuperaciones')" :meta="t('What the recall automations brought back', 'Lo que han recuperado las automatizaciones')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <ReportsPdfButton :target="pdfRoot" :title="t('Recalls', 'Recuperaciones')" :range="range" :practitioner-id="null" :clinic-id="null" />
      </div>
    </PageHeader>

    <div ref="pdfRoot" class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="recalls-report" :data-ready="loading ? undefined : 'true'">
      <div class="flex flex-wrap items-center gap-2">
        <ReportsDateRangeSelect v-model="range" />
        <span class="text-[12.5px] text-ink-muted">{{ t(`Messages sent in the period; replies and bookings up to ${RECALL_WINDOW_DAYS} days after each.`, `Mensajes enviados en el periodo; respuestas y reservas hasta ${RECALL_WINDOW_DAYS} días después de cada uno.`) }}</span>
      </div>

      <p v-if="failed" class="mt-4 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[13.5px] text-danger-text" data-cy="recalls-failed">
        {{ t('The report could not be loaded.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-2 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <div v-if="ruleOptions.length" class="mt-3 flex flex-wrap gap-1.5" role="group" :aria-label="t('Rules', 'Reglas')" data-pdf-skip>
        <button
          v-for="r in ruleOptions"
          :key="r.id"
          type="button"
          class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-10"
          :class="chosen.has(r.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'"
          :aria-pressed="chosen.has(r.id)"
          data-cy="recalls-rule"
          @click="toggleRule(r.id)"
        >
          {{ r.name }}
        </button>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ReportsStat :label="t('Contacted', 'Contactados')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-contacted">{{ report.totals.contacted }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('patients, each counted once', 'pacientes, cada uno una vez') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Replied', 'Respondieron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-replied">{{ report.totals.replied }} <span class="text-[14px] text-ink-muted">{{ pct(report.totals.replied, report.totals.contacted) }}</span></p>
          <p class="text-[12px] text-ink-faint2">{{ t('wrote back on WhatsApp', 'contestaron por WhatsApp') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Booked', 'Reservaron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-booked">{{ report.totals.booked }} <span class="text-[14px] text-ink-muted">{{ pct(report.totals.booked, report.totals.contacted) }}</span></p>
          <p class="text-[12px] text-ink-faint2">{{ t(`${report.totals.came} came · ${report.totals.byReceptionist} by the AI receptionist`, `${report.totals.came} vinieron · ${report.totals.byReceptionist} por la recepcionista IA`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Estimated value', 'Valor estimado')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-value">{{ formatEur(report.totals.valueCents) }}</p>
          <p class="text-[12px] text-ink-faint2">{{ t('price of the visits booked', 'precio de las visitas reservadas') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule class="mt-4" :title="t('By rule', 'Por regla')" :description="t(`September's manual recall booked 16 of 100. Patients contacted under ${RECALL_WINDOW_DAYS} days ago can still book.`, `El recall manual de septiembre reservó 16 de cada 100. Los contactados hace menos de ${RECALL_WINDOW_DAYS} días aún pueden reservar.`)" :loading="loading" skeleton="list" :rows="4">
        <p v-if="!report.byRule.length" class="mt-2 text-[13px] text-ink-muted" data-cy="recalls-empty">{{ t('No recall messages in this period.', 'No hay mensajes de recuperación en este periodo.') }}</p>
        <div v-else class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[640px]" data-cy="recalls-by-rule">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th :class="th">{{ t('Rule', 'Regla') }}</th>
                <th :class="th">{{ t('Contacted', 'Contactados') }}</th>
                <th :class="th">{{ t('Replied', 'Respondieron') }}</th>
                <th :class="th">{{ t('Booked', 'Reservaron') }}</th>
                <th :class="th">{{ t('Came', 'Vinieron') }}</th>
                <th :class="th">{{ t('Do not contact', 'No contactar') }}</th>
                <th :class="th">{{ t('Value', 'Valor') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="r in report.byRule" :key="r.ruleId" data-cy="recalls-rule-row">
                <td class="px-3 py-2 text-[13px] text-ink-800">{{ r.name }}</td>
                <td :class="td">{{ r.contacted }}<span v-if="r.waiting" class="ml-1 text-[11.5px] text-ink-muted">({{ t(`${r.waiting} waiting`, `${r.waiting} en espera`) }})</span></td>
                <td :class="td">{{ r.replied }} <span class="text-ink-muted">{{ pct(r.replied, r.contacted) }}</span></td>
                <td :class="td" data-cy="recalls-rule-booked">{{ r.booked }} <span class="text-ink-muted">{{ pct(r.booked, r.contacted) }}</span></td>
                <td :class="td">{{ r.came }}</td>
                <td :class="td">{{ r.optedOut }}</td>
                <td :class="td">{{ formatEur(r.valueCents) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>

      <ReportsModule class="mt-4" :title="t('Patients', 'Pacientes')" :description="t('Everyone a recall reached. Call whoever replied and did not book.', 'Todos a los que llegó un recall. Llama a quien respondió y no reservó.')" :loading="loading" skeleton="list" :rows="6">
        <div class="mt-2 flex flex-wrap gap-1.5" role="group" :aria-label="t('Status', 'Estado')" data-pdf-skip>
          <button type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-10" :class="!statusFilter ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'" :aria-pressed="!statusFilter" @click="statusFilter = ''">
            {{ t(`All · ${report.rows.length}`, `Todos · ${report.rows.length}`) }}
          </button>
          <button
            v-for="(s, key) in STATUS"
            :key="key"
            type="button"
            class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold touch:h-10"
            :class="statusFilter === key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'"
            :aria-pressed="statusFilter === key"
            :data-cy="`recalls-filter-${key}`"
            @click="statusFilter = key"
          >
            {{ t(`${s.en} · ${countOf(key)}`, `${s.es} · ${countOf(key)}`) }}
          </button>
        </div>
        <p v-if="!shownRows.length" class="mt-3 text-[13px] text-ink-muted">{{ t('Nobody here.', 'Nadie aquí.') }}</p>
        <div v-else class="mt-2 overflow-x-auto">
          <table class="w-full min-w-[680px]" data-cy="recalls-patients">
            <thead class="border-b border-line bg-surface-subtle">
              <tr>
                <th :class="th">{{ t('Patient', 'Paciente') }}</th>
                <th :class="th">{{ t('Rule', 'Regla') }}</th>
                <th :class="th">{{ t('Contacted', 'Contactado') }}</th>
                <th :class="th">{{ t('Status', 'Estado') }}</th>
                <th :class="th" />
              </tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="r in shownRows" :key="`${r.ruleId}:${r.patientId}`" data-cy="recalls-patient-row" :data-status="r.status">
                <td class="px-3 py-2 text-[13px]"><NuxtLink :to="`/patients/${r.patientId}`" class="font-medium text-ink-900 hover:text-brand-text">{{ r.name }}</NuxtLink></td>
                <td class="px-3 py-2 text-[13px] text-ink-700">{{ ruleName(r.ruleId) }}</td>
                <td class="px-3 py-2 text-[13px] text-ink-muted">{{ when(r.contactedAt) }}</td>
                <td class="px-3 py-2 text-[13px]">
                  <UiPill :tone="STATUS[r.status].tone">{{ t(STATUS[r.status].en, STATUS[r.status].es) }}</UiPill>
                  <span v-if="r.booking" class="ml-1.5 text-[12.5px] text-ink-muted">{{ t(`for ${when(r.booking.starts_at)}`, `para el ${when(r.booking.starts_at)}`) }}</span>
                </td>
                <td class="px-3 py-2 text-right text-[13px]" data-pdf-skip>
                  <NuxtLink :to="`/inbox?open=${r.patientId}`" class="font-semibold text-brand-text hover:underline">{{ t('Conversation', 'Conversación') }}</NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ReportsModule>
    </div>
  </div>
</template>
