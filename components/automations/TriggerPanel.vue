<script setup lang="ts">
import { DATE_SOURCE_LABELS, ENTRY_MODES, LEAD_STAGE_OPTIONS, LEAD_STOP_STAGES, TRIGGERS, TRIGGER_GROUPS, say, triggerDef, weekdayName } from '~/utils/automationCatalog'
import { FIELD, FIELD_NUMBER, HINT, LABEL, NOTE, SECTION, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'
import { scheduledSendLabel } from '~/utils/automationDescribe'
import { clinicTimeLabel } from '~/utils/bookingSlots'
import type { AudienceRef } from '~/utils/automationAudience'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, wallClockToUtc } from '~/utils/clinicClock'

// The trigger: what starts the automation, "only if" filters, and who can
// enter again -- or, for a segment, which patients and when, with a live
// count of who matches today.

const b = useBuilder()
const t = useT()

const rule = computed(() => b.draft.value.rule)
const def = computed(() => triggerDef(rule.value.trigger_event))
const isSegment = computed(() => rule.value.trigger_event === 'segment')
const lockedLead = computed(() => b.isLead.value && !b.hasGrowth.value)
const totals = computed(() => b.stats.value.rule)

function setFilters(filters: Record<string, any>) {
  b.updateRule({ filters })
}
function setNumberFilter(key: 'hours_before' | 'days_after' | 'days_overdue' | 'hours_after', raw: string, fallback: number) {
  b.updateRule({ filters: { ...rule.value.filters, [key]: Math.max(1, Math.round(Number(raw) || fallback)) } })
}
// Every Nth visit; 0 turns it off, leaving the first visit only.
function setEveryVisits(raw: string) {
  b.updateRule({ filters: { ...rule.value.filters, every_visits: Math.max(0, Math.round(Number(raw) || 0)) } })
}

// ---- segment
const segment = computed(() => rule.value.segment ?? { filters: {}, schedule: { kind: 'weekly' as const, weekday: 1, time: '10:00' }, reentry_days: null })
function setSegment(patch: Record<string, any>) {
  b.updateRule({ segment: { ...segment.value, ...patch } })
}
function setSchedule(patch: Record<string, any>) {
  setSegment({ schedule: { ...segment.value.schedule, ...patch } })
}
const recurring = computed(() => segment.value.schedule?.kind !== 'once')

// "A date on the record": which date, and the clinic's own date fields
// (Settings > Patient fields) as further choices.
const supabase = useSupabaseClient()
const dateFields = ref<{ id: string; label: string }[]>([])
watch(
  () => rule.value.trigger_event,
  async (event) => {
    if (event !== 'patient.date' || dateFields.value.length) return
    const { data } = await supabase.from('patient_attributes').select('id, label').eq('kind', 'date').is('archived_at', null).order('position')
    dateFields.value = (data ?? []) as { id: string; label: string }[]
  },
  { immediate: true },
)
function setDateSource(source: string) {
  // "Before" only for a date field; anything else counts forward.
  setFilters({ ...rule.value.filters, trigger_date: source, trigger_days: rule.value.filters.trigger_days ?? 7, ...(source.startsWith('field:') ? {} : { trigger_when: undefined }) })
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A group aimed at a saved list or segment, with others left out; the
// picker shows the choice before a list is chosen, so it has its own flag.
const savedAudienceMode = ref(false)
watch(() => rule.value.trigger_event, () => (savedAudienceMode.value = false))
function setExclude(i: number, ref: AudienceRef | null) {
  const next = [...(segment.value.exclude ?? [])]
  if (ref) next[i] = ref
  else next.splice(i, 1)
  setSegment({ exclude: next.filter(Boolean) })
}

// A one-off group send goes at the next check after it is switched on, or at
// a date and time chosen here: schedule.starts_at, which the engine already
// waits for (lastScheduledOccurrence). Taken in on the clinic's clock, so a
// "10:00" means 10:00 in Madrid whoever's laptop sets it -- the zone the
// engine reads the schedule in for these clinics.
const tz = computed(() => DEFAULT_CLINIC_TIMEZONE)
const scheduledAt = computed(() => (segment.value.schedule?.kind === 'once' ? segment.value.schedule?.starts_at ?? null : null))
const scheduledDate = computed(() => (scheduledAt.value ? clinicDateOf(new Date(scheduledAt.value), tz.value) : ''))
const scheduledTime = computed(() => (scheduledAt.value ? clinicTimeLabel(new Date(scheduledAt.value), tz.value) : '10:00'))
const scheduledPast = computed(() => !!scheduledAt.value && new Date(scheduledAt.value).getTime() <= Date.now())
function setOnceAt(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return
  setSchedule({ kind: 'once', starts_at: new Date(wallClockToUtc(date, time, tz.value)).toISOString() })
}
function scheduleOnce() {
  // Tomorrow at 10:00 to start from; the desk changes it.
  const tomorrow = clinicDateOf(new Date(Date.now() + 86_400_000), tz.value)
  setOnceAt(tomorrow, '10:00')
}
const TIMES = Array.from({ length: 28 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

// "Only those who have not been through here yet" is once_ever; "may come
// back after N days" lets them in again once their last run is that old.
const reentry = computed(() => (segment.value.reentry_days ? 'after' : 'once'))
function setReentry(kind: 'once' | 'after') {
  if (kind === 'once') {
    setSegment({ reentry_days: null })
    b.updateRule({ entry_mode: 'once_ever' })
  } else {
    setSegment({ reentry_days: segment.value.reentry_days || 90 })
    b.updateRule({ entry_mode: 'one_at_a_time' })
  }
}

const preview = ref<{ count: number; alreadyIn: number; whatsapp: number; email: number; sample: { id: string; name: string }[] } | null>(null)
const previewing = ref(false)
const showSample = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
async function refreshPreview() {
  if (!isSegment.value) return
  previewing.value = true
  try {
    preview.value = await useStaffFetch('/api/automations/segment-preview', {
      method: 'POST',
      body: { filters: segment.value.filters ?? {}, audience: segment.value.audience ?? null, exclude: segment.value.exclude ?? [], isMarketing: rule.value.is_marketing, ruleId: b.ruleId.value, entryMode: rule.value.entry_mode },
    })
  } catch {
    preview.value = null
  } finally {
    previewing.value = false
  }
}
watch(
  () => [isSegment.value, JSON.stringify(segment.value.filters), JSON.stringify(segment.value.audience ?? null), JSON.stringify(segment.value.exclude ?? []), rule.value.is_marketing],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(refreshPreview, 400)
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="lockedLead" class="flex flex-col gap-2 rounded-card border border-line bg-surface-subtle p-3.5" data-test="no-growth">
      <strong class="text-[13.5px] text-ink-900">{{ t('Lead automations are part of Growth.', 'Las automatizaciones de leads son de Growth.') }}</strong>
      <span class="text-[12.5px] leading-snug text-ink-500">{{ t('With Growth, every lead from your ads or your website enters here within minutes and is followed up until they book.', 'Con Growth, cada lead de tus anuncios o de la web entra aquí en minutos y recibe un seguimiento hasta que reserva.') }}</span>
      <NuxtLink to="/growth" class="inline-flex h-9 items-center self-start rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-surface hover:bg-brand-hover touch:h-11">{{ t('See Growth', 'Ver Growth') }}</NuxtLink>
      <p :class="HINT">{{ t('This automation is paused and kept exactly as it is. It works again as soon as Growth is on.', 'Esta automatización está pausada y guardada tal cual. Vuelve a funcionar al activar Growth.') }}</p>
    </div>

    <label :class="LABEL">
      {{ t('When…', 'Cuando…') }}
      <select :class="FIELD" :value="rule.trigger_event" data-test="trigger-select" @change="b.setTrigger(($event.target as HTMLSelectElement).value)">
        <optgroup v-for="g in TRIGGER_GROUPS" :key="g.key" :label="say(t, g.label)">
          <option
            v-for="tr in TRIGGERS.filter((x) => x.group === g.key)"
            :key="tr.value"
            :value="tr.value"
            :disabled="tr.growth && !b.hasGrowth.value && rule.trigger_event !== tr.value"
          >{{ say(t, tr.sentence) }}{{ tr.growth ? ' · GROWTH' : '' }}</option>
        </optgroup>
      </select>
    </label>
    <p v-if="def" :class="HINT">{{ say(t, def.description) }}</p>

    <label v-if="rule.trigger_event === 'appointment.hours_before'" :class="LABEL">
      {{ t('Hours before the appointment', 'Horas antes de la cita') }}
      <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.hours_before ?? 24" data-test="trigger-hours-before" @input="setNumberFilter('hours_before', ($event.target as HTMLInputElement).value, 24)" />
      <span :class="HINT">{{ t('For a second reminder at another time, create another automation on this trigger.', 'Para un segundo recordatorio en otro momento, crea otra automatización con este disparador.') }}</span>
    </label>
    <!-- On unless switched off (server/utils/evaluateAutomationFilters.ts):
    off is for an automation here that is not a reminder. -->
    <label v-if="rule.trigger_event === 'appointment.hours_before'" class="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700 touch:min-h-11">
      <input
        type="checkbox"
        class="mt-0.5 h-4 w-4 accent-brand"
        :checked="rule.filters.skip_if_answered !== false"
        data-test="trigger-skip-if-answered"
        @change="setFilters({ ...rule.filters, skip_if_answered: ($event.target as HTMLInputElement).checked })"
      />
      <span>
        {{ t('Not if they have already answered an earlier reminder (confirmed or asked to change the appointment)', 'No si ya ha contestado a un recordatorio anterior (confirmado o pedido cambiar la cita)') }}
        <span :class="['block', HINT]">{{ t('So a second reminder does not ask again what the first already got an answer to. Confirming when the appointment was booked does not count.', 'Así un segundo recordatorio no vuelve a preguntar lo que el primero ya respondió. Confirmar al reservar la cita no cuenta.') }}</span>
      </span>
    </label>
    <label v-if="rule.trigger_event === 'appointment.review_request'" :class="LABEL">
      {{ t('Days after the visit', 'Días después de la cita') }}
      <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.days_after ?? 2" data-test="trigger-days-after" @input="setNumberFilter('days_after', ($event.target as HTMLInputElement).value, 2)" />
    </label>
    <template v-if="rule.trigger_event === 'appointment.satisfaction'">
      <label :class="LABEL">
        {{ t('Hours after the visit', 'Horas después de la visita') }}
        <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.hours_after ?? 2" data-test="trigger-hours-after" @input="setNumberFilter('hours_after', ($event.target as HTMLInputElement).value, 2)" />
      </label>
      <label class="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700 touch:min-h-11">
        <input type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" :checked="rule.filters.first_visit !== false" data-test="trigger-first-visit" @change="setFilters({ ...rule.filters, first_visit: ($event.target as HTMLInputElement).checked })" />
        <span>{{ t('After the first visit', 'Tras la primera visita') }}</span>
      </label>
      <label :class="LABEL">
        {{ t('And every … visits (0 = never)', 'Y cada … visitas (0 = nunca)') }}
        <input type="number" min="0" :class="FIELD_NUMBER" :value="rule.filters.every_visits ?? 10" data-test="trigger-every-visits" @input="setEveryVisits(($event.target as HTMLInputElement).value)" />
        <span :class="HINT">{{ t('Never more than once a month per patient, whatever these say.', 'Nunca más de una vez al mes por paciente, digan lo que digan estos ajustes.') }}</span>
      </label>
    </template>
    <label v-if="rule.trigger_event === 'invoice.overdue'" :class="LABEL">
      {{ t('Days after the invoice, still unpaid', 'Días después de la factura, sin pagar') }}
      <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.days_overdue ?? 7" data-test="trigger-days-overdue" @input="setNumberFilter('days_overdue', ($event.target as HTMLInputElement).value, 7)" />
      <span :class="HINT">{{ t('Only invoices that reach this many days from now on: switching it on does not message old debts. For a second reminder, create another automation with more days.', 'Solo las facturas que cumplan estos días a partir de ahora: activarla no avisa de deudas antiguas. Para un segundo recordatorio, crea otra automatización con más días.') }}</span>
    </label>

    <label v-if="rule.trigger_event === 'patient.tag_added' || rule.trigger_event === 'patient.tag_removed'" :class="LABEL">
      {{ t('Which tag', 'Qué etiqueta') }}
      <input :class="FIELD" :value="rule.filters.trigger_tag ?? ''" :placeholder="t('Any tag', 'Cualquier etiqueta')" data-test="trigger-tag" @input="setFilters({ ...rule.filters, trigger_tag: ($event.target as HTMLInputElement).value })" />
      <span :class="HINT">{{ t('Capitals do not matter. Left empty, any tag starts it.', 'Da igual mayúsculas o minúsculas. Si se deja vacía, la inicia cualquier etiqueta.') }}</span>
    </label>
    <div v-if="rule.trigger_event === 'satisfaction.answered'" :class="LABEL">
      {{ t('With a score of', 'Con una nota de') }}
      <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Score', 'Nota')">
        <button v-for="o in [{ v: '', l: t('Any', 'Cualquiera') }, { v: 'high', l: '4-5' }, { v: 'low', l: '1-3' }]" :key="o.v" type="button" :class="segmentBtn((rule.filters.trigger_score ?? '') === o.v)" :aria-pressed="(rule.filters.trigger_score ?? '') === o.v" :data-test="`trigger-score-${o.v || 'any'}`" @click="setFilters({ ...rule.filters, trigger_score: o.v || undefined })">{{ o.l }}</button>
      </span>
      <span :class="HINT">{{ t('Their first answer only: changing the score afterwards does not start it again.', 'Solo su primera respuesta: cambiar la nota después no la inicia otra vez.') }}</span>
    </div>
    <div v-if="rule.trigger_event === 'doc.completed'" :class="LABEL">
      {{ t('Which forms', 'Qué formularios') }}
      <AutomationsMultiPick
        :model-value="(rule.filters.trigger_doc_template_ids as string[] | undefined) ?? []"
        :options="b.docTemplates.value.map((d) => ({ value: d.id, label: d.title }))"
        :placeholder="t('Any form', 'Cualquier formulario')"
        test-id="trigger-doc-templates"
        @update:model-value="setFilters({ ...rule.filters, trigger_doc_template_ids: $event.length ? $event : undefined })"
      />
      <span :class="HINT">{{ t('Forms completed before it is switched on, or more than two days ago, do not start it.', 'Los formularios completados antes de activarla, o hace más de dos días, no la inician.') }}</span>
    </div>
    <label v-if="rule.trigger_event === 'lead.stage_changed'" :class="LABEL">
      {{ t('Moved to', 'Movido a') }}
      <select :class="FIELD" :value="rule.filters.trigger_lead_stage ?? ''" data-test="trigger-lead-stage" @change="setFilters({ ...rule.filters, trigger_lead_stage: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">{{ t('Any stage', 'Cualquier etapa') }}</option>
        <option v-for="o in LEAD_STAGE_OPTIONS.filter((x) => !LEAD_STOP_STAGES.includes(x.value))" :key="o.value" :value="o.value">{{ say(t, o.label) }}</option>
      </select>
      <span :class="HINT">{{ t('Each lead enters once. Not offered: Patient and Lost, because automations stop for a lead in either. A booking moving the lead to "Booked" by itself does not count; for that, use "Wait until they book" in a New lead automation.', 'Cada lead entra una vez. No se ofrecen Paciente ni Perdido, porque las automatizaciones se detienen para un lead en cualquiera de las dos. Que una reserva lo pase sola a «Con cita» no cuenta; para eso, usa «Esperar hasta que reserve» en una automatización de Lead nuevo.') }}</span>
    </label>

    <template v-if="rule.trigger_event === 'patient.date'">
      <label :class="LABEL">
        {{ t('Counting from', 'Contando desde') }}
        <select :class="FIELD" :value="rule.filters.trigger_date ?? ''" data-test="trigger-date-source" @change="setDateSource(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>{{ t('Choose a date', 'Elige una fecha') }}</option>
          <option v-for="(label, key) in DATE_SOURCE_LABELS" :key="key" :value="key">{{ capitalize(say(t, label)) }}</option>
          <optgroup v-if="dateFields.length" :label="t('Your date fields', 'Tus campos de fecha')">
            <option v-for="f in dateFields" :key="f.id" :value="`field:${f.id}`">{{ f.label }}</option>
          </optgroup>
        </select>
      </label>
      <div class="flex flex-wrap items-end gap-2.5">
        <label :class="LABEL">
          {{ t('Days', 'Días') }}
          <input type="number" min="0" max="3650" :class="FIELD_NUMBER" :value="rule.filters.trigger_days ?? 7" data-test="trigger-date-days" @input="setFilters({ ...rule.filters, trigger_days: Math.max(0, Math.min(3650, Math.round(Number(($event.target as HTMLInputElement).value) || 0))) })" />
        </label>
        <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Before or after', 'Antes o después')">
          <button type="button" :class="segmentBtn(rule.filters.trigger_when !== 'before')" :aria-pressed="rule.filters.trigger_when !== 'before'" data-test="trigger-date-after" @click="setFilters({ ...rule.filters, trigger_when: undefined })">{{ t('after', 'después') }}</button>
          <button type="button" :class="segmentBtn(rule.filters.trigger_when === 'before')" :aria-pressed="rule.filters.trigger_when === 'before'" :disabled="!String(rule.filters.trigger_date ?? '').startsWith('field:')" class="disabled:cursor-not-allowed disabled:opacity-50" data-test="trigger-date-before" @click="setFilters({ ...rule.filters, trigger_when: 'before' })">{{ t('before', 'antes') }}</button>
        </span>
      </div>
      <span :class="HINT">{{ t('Each day from 9:00, clinic time. "Before" is for a date field of your own, which can hold a date still to come. After the last visit: only for whoever has not been back since.', 'Cada día desde las 9:00, hora de la clínica. «Antes» es para un campo de fecha propio, que puede tener una fecha por venir. Tras la última visita: solo para quien no ha vuelto desde entonces.') }}</span>
    </template>
    <template v-if="rule.trigger_event === 'audience.entered'">
      <div :class="LABEL">
        {{ t('The list or segment', 'La lista o el segmento') }}
        <AutomationsAudiencePicker :model-value="(rule.filters.trigger_audience as AudienceRef | undefined) ?? null" test-id="trigger-audience" @update:model-value="setFilters({ ...rule.filters, trigger_audience: $event ?? undefined })" />
      </div>
      <label class="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700 touch:min-h-11">
        <input type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" :checked="rule.filters.include_current === true" data-test="trigger-include-current" @change="setFilters({ ...rule.filters, include_current: ($event.target as HTMLInputElement).checked || undefined })" />
        <span>
          {{ t('Also the people already in it, when it is switched on', 'También quienes ya están, al activarla') }}
          <span :class="['block', HINT]">{{ t('Otherwise only those who enter from then on. Paused and switched back on, it carries on from that moment: whoever entered meanwhile is not enrolled late.', 'Si no, solo los que entren desde entonces. Si se pausa y se vuelve a activar, sigue desde ese momento: quienes entraron mientras tanto no se inscriben tarde.') }}</span>
        </span>
      </label>
    </template>
    <template v-if="rule.trigger_event === 'care_plan.milestone'">
      <div :class="LABEL">
        {{ t('When', 'Cuándo') }}
        <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Milestone', 'Hito')">
          <button v-for="o in [{ v: '', l: t('Re-exam is next', 'Toca revisión') }, { v: 'finished', l: t('Plan finished', 'Plan terminado') }, { v: 'visit', l: t('Visit number', 'Visita número') }]" :key="o.v" type="button" :class="segmentBtn((rule.filters.trigger_milestone ?? '') === o.v)" :aria-pressed="(rule.filters.trigger_milestone ?? '') === o.v" :data-test="`trigger-milestone-${o.v || 'reexam'}`" @click="setFilters({ ...rule.filters, trigger_milestone: o.v || undefined })">{{ o.l }}</button>
        </span>
        <span :class="HINT">{{ (rule.filters.trigger_milestone ?? '') === '' ? t('After the visit before one the plan marks as a re-exam, so it can be booked in time.', 'Tras la visita anterior a una que el plan marca como revisión, para que dé tiempo a reservarla.') : rule.filters.trigger_milestone === 'finished' ? t("After the plan's last visit.", 'Tras la última visita del plan.') : t('After that visit of the plan, counting as the plan does: no cancelled or missed ones.', 'Tras esa visita del plan, contando como el plan: sin las canceladas ni las de no asistió.') }}</span>
      </div>
      <label v-if="rule.filters.trigger_milestone === 'visit'" :class="LABEL">
        {{ t('Visit number', 'Visita número') }}
        <input type="number" min="1" :class="FIELD_NUMBER" :value="rule.filters.trigger_visit_number ?? 6" data-test="trigger-visit-number" @input="setFilters({ ...rule.filters, trigger_visit_number: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 1)) })" />
      </label>
    </template>
    <div v-if="rule.trigger_event === 'bono.running_low'" :class="LABEL">
      {{ t('Sessions left', 'Sesiones restantes') }}
      <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Sessions left', 'Sesiones restantes')">
        <button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="segmentBtn((rule.filters.trigger_sessions_left ?? 1) === n)" :aria-pressed="(rule.filters.trigger_sessions_left ?? 1) === n" :data-test="`trigger-sessions-left-${n}`" @click="setFilters({ ...rule.filters, trigger_sessions_left: n })">{{ n === 0 ? t('Used up', 'Agotado') : n }}</button>
      </span>
      <span :class="HINT">{{ t('Once per bono. Sessions brought in by an import do not count.', 'Una vez por bono. Las sesiones traídas por una importación no cuentan.') }}</span>
    </div>

    <!-- A group of patients -->
    <template v-if="isSegment">
      <div :class="SEGMENT_WRAP" role="group" :aria-label="t('How often', 'Con qué frecuencia')">
        <button type="button" :class="segmentBtn(!recurring)" :aria-pressed="!recurring" data-test="segment-once" @click="setSchedule({ kind: 'once', starts_at: undefined })">{{ t('Once', 'Una vez') }}</button>
        <button type="button" :class="segmentBtn(recurring)" :aria-pressed="recurring" data-test="segment-recurring" @click="setSchedule({ kind: 'weekly', weekday: segment.schedule?.weekday ?? 1, time: segment.schedule?.time ?? '10:00', starts_at: undefined })">{{ t('Repeats', 'Se repite') }}</button>
      </div>
      <div v-if="recurring" class="grid grid-cols-2 gap-2.5">
        <label :class="LABEL">
          {{ t('Every', 'Cada') }}
          <select
            :class="FIELD"
            :value="segment.schedule?.kind === 'daily' ? 'daily' : String(segment.schedule?.weekday ?? 1)"
            data-test="segment-day"
            @change="(e) => { const v = (e.target as HTMLSelectElement).value; setSchedule(v === 'daily' ? { kind: 'daily', weekday: undefined } : { kind: 'weekly', weekday: Number(v) }) }"
          >
            <option value="daily">{{ t('Day', 'Día') }}</option>
            <option v-for="d in 7" :key="d" :value="String(d)">{{ weekdayName(t, d) }}</option>
          </select>
        </label>
        <label :class="LABEL">
          {{ t('At', 'A las') }}
          <select :class="FIELD" :value="segment.schedule?.time ?? '10:00'" data-test="segment-time" @change="setSchedule({ time: ($event.target as HTMLSelectElement).value })">
            <option v-for="tm in TIMES" :key="tm" :value="tm">{{ tm }}</option>
          </select>
        </label>
      </div>
      <template v-else>
        <div :class="SEGMENT_WRAP" role="group" :aria-label="t('When', 'Cuándo')">
          <button type="button" :class="segmentBtn(!scheduledAt)" :aria-pressed="!scheduledAt" data-test="segment-once-now" @click="setSchedule({ kind: 'once', starts_at: undefined })">{{ t('When switched on', 'Al activarla') }}</button>
          <button type="button" :class="segmentBtn(!!scheduledAt)" :aria-pressed="!!scheduledAt" data-test="segment-once-scheduled" @click="scheduledAt || scheduleOnce()">{{ t('On a date', 'En una fecha') }}</button>
        </div>
        <div v-if="scheduledAt" class="grid grid-cols-2 gap-2.5">
          <label :class="LABEL">
            {{ t('Day', 'Día') }}
            <input type="date" :class="FIELD" :value="scheduledDate" data-test="segment-once-date" @change="setOnceAt(($event.target as HTMLInputElement).value, scheduledTime)" />
          </label>
          <label :class="LABEL">
            {{ t('At', 'A las') }}
            <input type="time" step="300" :class="FIELD" :value="scheduledTime" data-test="segment-once-time" @change="setOnceAt(scheduledDate, ($event.target as HTMLInputElement).value)" />
          </label>
        </div>
        <p v-if="scheduledAt && scheduledPast" :class="HINT" class="!text-warning-text" data-test="segment-once-past">{{ t('That time has passed: they would enter at the next check after it is switched on.', 'Esa hora ya ha pasado: entrarían en la siguiente revisión tras activarla.') }}</p>
        <p v-else-if="scheduledAt" :class="HINT">{{ t(`Everyone who matches then enters once, on ${scheduledSendLabel(scheduledAt, t, tz)} (within 15 minutes). Switch it on beforehand: until then nothing is sent.`, `Todos los que coincidan entonces entran una vez, el ${scheduledSendLabel(scheduledAt, t, tz)} (antes de 15 minutos). Actívala antes: hasta entonces no se envía nada.`) }}</p>
        <p v-else :class="HINT">{{ t('Everyone who matches enters once, at the next check after it is switched on (within 15 minutes).', 'Todos los que coinciden entran una vez, en la siguiente revisión tras activarla (antes de 15 minutos).') }}</p>
      </template>
      <label :class="LABEL">
        {{ t('At most, per day', 'Como mucho, al día') }}
        <input
          type="number"
          min="1"
          :class="FIELD_NUMBER"
          :value="segment.daily_limit ?? ''"
          :placeholder="t('no limit', 'sin límite')"
          data-test="segment-daily-limit"
          @input="setSegment({ daily_limit: Number(($event.target as HTMLInputElement).value) >= 1 ? Math.round(Number(($event.target as HTMLInputElement).value)) : null })"
        />
        <span :class="HINT">{{ t('Patients who enter each day, the most recently seen first; the rest wait for the next day. Keeps a long list from going out in one morning (failed sends count against the WhatsApp number) and the Inbox answerable.', 'Pacientes que entran cada día, primero los vistos más recientemente; el resto espera al día siguiente. Evita que una lista larga salga en una mañana (los envíos fallidos cuentan contra el número de WhatsApp) y que el Inbox se desborde.') }}</span>
      </label>

      <div class="flex flex-col gap-2" data-test="segment-who">
        <span :class="SECTION">{{ t('Who', 'Quiénes') }}</span>
        <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Who', 'Quiénes')">
          <button type="button" :class="segmentBtn(!segment.audience)" :aria-pressed="!segment.audience" data-test="segment-who-filters" @click="setSegment({ audience: null, exclude: [] })">{{ t('Patients who…', 'Pacientes que…') }}</button>
          <button type="button" :class="segmentBtn(!!segment.audience)" :aria-pressed="!!segment.audience" data-test="segment-who-saved" @click="savedAudienceMode = true">{{ t('A list or segment', 'Una lista o un segmento') }}</button>
        </span>
      </div>
      <div v-if="segment.audience || savedAudienceMode" class="flex flex-col gap-2.5">
        <AutomationsAudiencePicker :model-value="segment.audience ?? null" test-id="segment-audience" @update:model-value="setSegment({ audience: $event })" />
        <div :class="LABEL">
          {{ t('Leave out whoever is in', 'Excepto quienes estén en') }}
          <AutomationsAudiencePicker
            v-for="(ex, i) in [...(segment.exclude ?? []), null]"
            :key="ex ? `${ex.kind}:${ex.id}` : `new-${(segment.exclude ?? []).length}`"
            :model-value="ex"
            :placeholder="ex ? undefined : t('Nobody left out', 'Sin excluir a nadie')"
            :test-id="`segment-exclude-${i}`"
            @update:model-value="setExclude(i, $event)"
          />
        </div>
        <span :class="HINT">{{ t("Whoever is in it when the send goes out: the list, or the segment's own filters, decide who that is.", 'Quienes estén en ella cuando salga el envío: lo deciden la lista, o los filtros del propio segmento.') }}</span>
      </div>
      <div v-if="!segment.audience && !savedAudienceMode" class="flex flex-col gap-2">
        <AutomationsFilterEditor
          :model-value="segment.filters ?? {}"
          mode="segment"
          :appointment-context="false"
          test-prefix="segment-filter"
          @update:model-value="setSegment({ filters: $event })"
        />
      </div>

      <div class="flex flex-col gap-1.5 rounded-card border border-brand-tintBorder bg-brand-tint px-3.5 py-3" data-test="segment-count">
        <div class="flex items-baseline gap-2">
          <strong class="font-mono text-[22px] text-brand-text">{{ previewing && !preview ? '…' : (preview?.count ?? '—') }}</strong>
          <span class="text-[12.5px] text-ink-700">
            {{ t('patients match today.', 'pacientes coinciden hoy.') }}
            <button v-if="preview?.count" type="button" class="font-semibold text-brand-text underline" @click="showSample = !showSample">{{ showSample ? t('Hide the list', 'Ocultar la lista') : t('See the list', 'Ver la lista') }}</button>
          </span>
        </div>
        <p v-if="preview && preview.alreadyIn > 0" :class="HINT">{{ t(`${preview.alreadyIn} of them have already been through, so they will not enter again.`, `${preview.alreadyIn} ya han pasado por aquí, así que no volverán a entrar.`) }}</p>
        <ul v-if="showSample && preview" class="mt-1 max-h-40 overflow-y-auto text-[12.5px] text-ink-700">
          <li v-for="p in preview.sample" :key="p.id"><NuxtLink :to="`/patients/${p.id}`" class="hover:underline">{{ p.name }}</NuxtLink></li>
          <li v-if="preview.count > preview.sample.length" class="text-ink-muted">{{ t(`and ${preview.count - preview.sample.length} more`, `y ${preview.count - preview.sample.length} más`) }}</li>
        </ul>
      </div>

      <div v-if="recurring" class="flex flex-col gap-2" role="radiogroup" :aria-label="t('Each time it repeats', 'Cada vez que se repite')">
        <span :class="SECTION">{{ t('Each time it repeats', 'Cada vez que se repite') }}</span>
        <label class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="reentry" class="h-4 w-4 accent-brand" :checked="reentry === 'once'" @change="setReentry('once')" />
          {{ t('Only those who have not been through here yet', 'Solo entran los que aún no han pasado por aquí') }}
        </label>
        <label class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="reentry" class="h-4 w-4 accent-brand" :checked="reentry === 'after'" @change="setReentry('after')" />
          {{ t('They can enter again after', 'Pueden volver a entrar pasados') }}
          <input
            type="number"
            min="1"
            :class="FIELD_NUMBER"
            :value="segment.reentry_days ?? 90"
            :aria-label="t('days', 'días')"
            :disabled="reentry !== 'after'"
            @input="setSegment({ reentry_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 90)) })"
          />
          {{ t('days', 'días') }}
        </label>
      </div>
      <p :class="NOTE">{{ t('Minors and patients marked "do not contact" never enter. Marketing consent is applied to every marketing message.', 'Menores y pacientes con «no contactar» nunca entran. El consentimiento de marketing se aplica en cada mensaje comercial.') }}</p>
    </template>

    <!-- An event -->
    <template v-else-if="!b.isLead.value">
      <div class="flex flex-col gap-2">
        <span :class="SECTION">{{ t('Only if', 'Solo si') }}</span>
        <AutomationsFilterEditor
          :model-value="rule.filters"
          mode="trigger"
          :appointment-context="def?.appointmentContext ?? false"
          test-prefix="trigger-filter"
          @update:model-value="setFilters"
        />
      </div>

      <div class="flex flex-col gap-2" role="radiogroup" :aria-label="t('If they are already inside', 'Si ya está dentro')">
        <span :class="SECTION">{{ t('If they are already inside', 'Si ya está dentro') }}</span>
        <label v-for="m in ENTRY_MODES" :key="m.value" class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
          <input type="radio" name="entry" class="h-4 w-4 accent-brand" :checked="rule.entry_mode === m.value" :data-test="`entry-${m.value}`" @change="b.updateRule({ entry_mode: m.value })" />
          {{ say(t, m.label) }}
        </label>
      </div>
    </template>

    <p v-else :class="HINT">{{ t('A lead enters once, ever: the same lead never gets this sequence twice.', 'Un lead entra una sola vez: el mismo lead nunca recibe esta secuencia dos veces.') }}</p>

    <!-- The whole automation's last 30 days, every step together. -->
    <template v-if="totals">
      <span :class="SECTION">{{ t('This automation, last 30 days', 'Esta automatización, últimos 30 días') }}</span>
      <div class="grid grid-cols-2 gap-2" data-test="rule-totals">
        <div class="flex flex-col rounded-ctl border border-line bg-surface-subtle p-3">
          <span class="text-[11px] text-ink-muted">{{ t('Entered', 'Entraron') }}</span>
          <span class="font-mono text-[16px] font-semibold text-ink-900" data-test="rule-entered">{{ totals.entered }}</span>
        </div>
        <div class="flex flex-col rounded-ctl border border-line bg-surface-subtle p-3">
          <span class="text-[11px] text-ink-muted">{{ t('Inside now', 'Dentro ahora') }}</span>
          <span class="font-mono text-[16px] font-semibold text-ink-900">{{ totals.inside }}</span>
        </div>
      </div>
      <AutomationsMessageStats
        v-if="totals.whatsapp.sent + totals.whatsapp.failed + totals.whatsapp.recorded > 0 || b.draft.value.steps.some((s) => s.action_type === 'whatsapp_template')"
        channel="whatsapp"
        :stats="totals.whatsapp"
        :hidden="!b.canReadWhatsApp.value"
        test-id="rule-whatsapp-stats"
      />
      <AutomationsMessageStats
        v-if="totals.email.sent + totals.email.recorded > 0 || b.draft.value.steps.some((s) => s.action_type === 'email')"
        channel="email"
        :stats="totals.email"
        test-id="rule-email-stats"
      />
    </template>
  </div>
</template>
