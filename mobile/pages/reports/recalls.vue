<script setup lang="ts">
// Recuperaciones (the report), on the phone: the web's
// pages/reports/recalls.vue, with the same reads and the same arithmetic
// (utils/recallReport.ts), so a figure here is the figure there. Not the
// app's /recalls, which is the worklist of who to call; this is what the
// recall automations brought back. Reshaped for a phone: the rules to count
// are chips in the filter row beside the period; the seven-column "By rule"
// table is one row per rule, booked on the right and the other figures in a
// small grid beneath; the patients table is a list (first 50, "Ver más" for
// the rest) whose status filter is a picker with the counts in it. Left out:
// the PDF button (no PDF on the app yet) and the "Conversation" link, since
// the app's Inbox does not open on a patient from a link -- the row opens
// the patient, whose record reaches their conversation.
import { computePresetRange, rangeBounds } from '../../../composables/useDateRangePresets'
import { fetchAllRows } from '../../../composables/useFetchAllRows'
import { formatEur } from '../../../utils/billing'
import { isRecallRule, recallReport, RECALL_WINDOW_DAYS, type RecallBooking, type RecallPatient, type RecallReply, type RecallRule, type RecallSend, type RecallStatus } from '../../../utils/recallReport'

definePageMeta({ layout: 'practitioner' })

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

const PATH = '/reports/recalls'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()

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
// Only once the role is known to include it: a refused read would come back
// empty and read as "no recall messages".
const ready = computed(() => !!context.value && canOpen(PATH))
watch(ready, (ok) => { if (ok) load() }, { immediate: true })
watch(range, () => { if (ready.value) load() }, { deep: true })

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
const statusOptions = computed(() => (Object.keys(STATUS) as RecallStatus[]).map((key) => ({ id: key, name: t(`${STATUS[key].en} · ${countOf(key)}`, `${STATUS[key].es} · ${countOf(key)}`) })))
const statusModel = computed({ get: () => statusFilter.value as string, set: (v: string) => { statusFilter.value = v as RecallStatus | '' } })
const ruleName = (id: string) => rules.value.find((r) => r.id === id)?.name ?? '—'

const rowLimit = ref(50)
watch(shownRows, () => { rowLimit.value = 50 })
const visibleRows = computed(() => shownRows.value.slice(0, rowLimit.value))

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const figureLabel = 'text-[11px] font-medium uppercase tracking-wide text-ink-muted'
const figureValue = 'font-mono text-[13.5px] font-semibold tabular-nums text-ink-900'
</script>

<template>
  <ReportScreen
    :title="t('Recalls', 'Recuperaciones')"
    :path="PATH"
    :description="t(`What the recall automations brought back. Messages sent in the period; replies and bookings up to ${RECALL_WINDOW_DAYS} days after each.`, `Lo que han recuperado las automatizaciones. Mensajes enviados en el periodo; respuestas y reservas hasta ${RECALL_WINDOW_DAYS} días después de cada uno.`)"
  >
    <template #filters>
      <ReportRangePicker v-model="range" />
      <!-- The rules to count, toggled on and off, as the web's chips. -->
      <button
        v-for="r in ruleOptions"
        :key="r.id"
        type="button"
        class="flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold"
        :class="chosen.has(r.id) ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500'"
        :aria-pressed="chosen.has(r.id)"
        data-cy="recalls-rule"
        @click="toggleRule(r.id)"
      >
        {{ r.name }}
      </button>
    </template>

    <div class="flex flex-col gap-3" data-cy="recalls-report" :data-ready="loading ? undefined : 'true'">
      <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="recalls-failed">
        {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ReportsStat :label="t('Contacted', 'Contactados')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-contacted">{{ report.totals.contacted }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('patients, each counted once', 'pacientes, cada uno una vez') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Replied', 'Respondieron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-replied">{{ report.totals.replied }} <span class="text-[14px] text-ink-muted">{{ pct(report.totals.replied, report.totals.contacted) }}</span></p>
          <p class="text-[12px] text-ink-muted">{{ t('wrote back on WhatsApp', 'contestaron por WhatsApp') }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Booked', 'Reservaron')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-booked">{{ report.totals.booked }} <span class="text-[14px] text-ink-muted">{{ pct(report.totals.booked, report.totals.contacted) }}</span></p>
          <p class="text-[12px] text-ink-muted">{{ t(`${report.totals.came} came · ${report.totals.byReceptionist} by the AI receptionist`, `${report.totals.came} vinieron · ${report.totals.byReceptionist} por la recepcionista IA`) }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Estimated value', 'Valor estimado')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="recalls-value">{{ formatEur(report.totals.valueCents) }}</p>
          <p class="text-[12px] text-ink-muted">{{ t('price of the visits booked', 'precio de las visitas reservadas') }}</p>
        </ReportsStat>
      </div>

      <ReportsModule :title="t('By rule', 'Por regla')" :description="t(`September's manual recall booked 16 of 100. Patients contacted under ${RECALL_WINDOW_DAYS} days ago can still book.`, `El recall manual de septiembre reservó 16 de cada 100. Los contactados hace menos de ${RECALL_WINDOW_DAYS} días aún pueden reservar.`)" :loading="loading" skeleton="list" :rows="4">
        <p v-if="!report.byRule.length" class="py-3 text-[13.5px] text-ink-faint" data-cy="recalls-empty">{{ t('No recall messages in this period.', 'No hay mensajes de recuperación en este periodo.') }}</p>
        <ul v-else class="mt-1" data-cy="recalls-by-rule">
          <li v-for="r in report.byRule" :key="r.ruleId" class="border-b border-line-divider py-2.5 last:border-b-0" data-cy="recalls-rule-row">
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate text-[14.5px] font-medium text-ink-900">{{ r.name }}</span>
              <span class="shrink-0 text-right">
                <span class="font-mono text-[14.5px] font-semibold tabular-nums text-success-text" data-cy="recalls-rule-booked">{{ r.booked }}</span>
                <span class="ml-1 text-[11.5px] text-ink-muted">{{ t(`booked · ${pct(r.booked, r.contacted)}`, `reservaron · ${pct(r.booked, r.contacted)}`) }}</span>
              </span>
            </div>
            <dl class="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1.5">
              <div>
                <dt :class="figureLabel">{{ t('Contacted', 'Contactados') }}</dt>
                <dd :class="figureValue">{{ r.contacted }}<span v-if="r.waiting" class="ml-1 font-sans text-[11.5px] font-normal text-ink-muted">({{ t(`${r.waiting} waiting`, `${r.waiting} en espera`) }})</span></dd>
              </div>
              <div>
                <dt :class="figureLabel">{{ t('Replied', 'Respondieron') }}</dt>
                <dd :class="figureValue">{{ r.replied }} <span class="font-normal text-ink-muted">{{ pct(r.replied, r.contacted) }}</span></dd>
              </div>
              <div>
                <dt :class="figureLabel">{{ t('Came', 'Vinieron') }}</dt>
                <dd :class="figureValue">{{ r.came }}</dd>
              </div>
              <div>
                <dt :class="figureLabel">{{ t('Do not contact', 'No contactar') }}</dt>
                <dd :class="figureValue">{{ r.optedOut }}</dd>
              </div>
              <div class="col-span-2">
                <dt :class="figureLabel">{{ t('Value', 'Valor') }}</dt>
                <dd :class="figureValue">{{ formatEur(r.valueCents) }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </ReportsModule>

      <ReportsModule :title="t('Patients', 'Pacientes')" :description="t('Everyone a recall reached. Call whoever replied and did not book.', 'Todos a los que llegó un recall. Llama a quien respondió y no reservó.')" :loading="loading" skeleton="list" :rows="6">
        <div class="mt-2 flex">
          <ReportSelect v-model="statusModel" :options="statusOptions" :all-label="t(`All · ${report.rows.length}`, `Todos · ${report.rows.length}`)" :label="t('Status', 'Estado')" data-cy="recalls-status-filter" />
        </div>
        <p v-if="!shownRows.length" class="py-3 text-[13.5px] text-ink-faint">{{ t('Nobody here.', 'Nadie aquí.') }}</p>
        <ul v-else class="mt-1" data-cy="recalls-patients">
          <ReportRow
            v-for="r in visibleRows"
            :key="`${r.ruleId}:${r.patientId}`"
            :to="`/patients/${r.patientId}`"
            :title="shown(r.name)"
            :subtitle="`${ruleName(r.ruleId)} · ${t('contacted', 'contactado')} ${when(r.contactedAt)}${r.booking ? ` · ${t(`for ${when(r.booking.starts_at)}`, `para el ${when(r.booking.starts_at)}`)}` : ''}`"
            data-cy="recalls-patient-row"
            :data-status="r.status"
          >
            <template #trailing>
              <UiPill :tone="STATUS[r.status].tone" class="shrink-0">{{ t(STATUS[r.status].en, STATUS[r.status].es) }}</UiPill>
            </template>
          </ReportRow>
        </ul>
        <button v-if="shownRows.length > rowLimit" type="button" class="mt-1 h-11 w-full rounded-ctl border border-line-control text-[13.5px] font-semibold text-ink-700" data-cy="recalls-patients-more" @click="rowLimit += 50">
          {{ t(`Show more (${shownRows.length - rowLimit})`, `Ver más (${shownRows.length - rowLimit})`) }}
        </button>
      </ReportsModule>
    </div>
  </ReportScreen>
</template>
