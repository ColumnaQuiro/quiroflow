<script setup lang="ts">
import { ENTRY_MODES, LEAD_STAGE_OPTIONS, LEAD_STOP_STAGES, say, weekdayName } from '~/utils/automationCatalog'
import { TRIGGER_SUBJECTS, defaultAtom, momentDef, momentsOf, type TimingUnit, type TriggerAtom, type TriggerSubject, type TriggerTiming } from '~/utils/automationTrigger'
import { timingText } from '~/utils/automationTriggerText'
import { FIELD, FIELD_NUMBER, HINT, LABEL, NOTE, SECTION, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'
import { scheduledSendLabel } from '~/utils/automationDescribe'
import { clinicTimeLabel } from '~/utils/bookingSlots'
import type { AudienceRef } from '~/utils/automationAudience'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, wallClockToUtc } from '~/utils/clinicClock'

// The trigger: what starts the automation -- a subject, a moment of it and,
// where it makes sense, a timing (utils/automationTrigger.ts) -- the "only if"
// filters, and who can enter again; or, for a segment, which patients and
// when, with a live count of who matches today.

const b = useBuilder()
const t = useT()

const rule = computed(() => b.draft.value.rule)
const atom = computed(() => rule.value.trigger)
const def = computed(() => momentDef(atom.value.subject, atom.value.moment))
const key = computed(() => `${atom.value.subject}.${atom.value.moment}`)
const isSegment = computed(() => atom.value.subject === 'group')

function chooseSubject(subject: string) {
  if (subject === 'group') return b.setTrigger(defaultAtom('group', 'scheduled'))
  const first = momentsOf(subject)[0]
  if (first) b.setTrigger(defaultAtom(subject as TriggerSubject, first.moment))
}
function chooseMoment(moment: string) {
  b.setTrigger(defaultAtom(atom.value.subject, moment))
}
function setAtom(patch: Partial<TriggerAtom>) {
  b.setTrigger({ ...atom.value, ...patch })
}
/** The moment's own setting; an empty choice is no key at all. */
function setOptions(patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...atom.value.options, ...patch }
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k]
  setAtom({ options: next })
}
function setSendTo(referrer: boolean) {
  const { send_to: _, ...rest } = atom.value
  b.setTrigger(referrer ? { ...rest, send_to: 'referrer' } : rest)
}

// ---- timing
const units = computed<TimingUnit[]>(() => (def.value?.kind === 'event' ? ['minutes', 'hours', 'days'] : (def.value?.units ?? ['days'])))
const directions = computed(() => (def.value?.kind === 'event' ? ['after'] : (def.value?.directions ?? ['after'])))
const unitLabel = (u: TimingUnit) => (u === 'minutes' ? t('minutes', 'minutos') : u === 'hours' ? t('hours', 'horas') : t('days', 'días'))
function setTimed(on: boolean) {
  if (!on) return setAtom({ timing: null })
  setAtom({ timing: def.value?.kind === 'event' ? { amount: 2, unit: 'hours', direction: 'after' } : { amount: 7, unit: 'days', direction: 'after' } })
}
function setTiming(patch: Partial<TriggerTiming>) {
  const next: TriggerTiming = { ...(atom.value.timing ?? { amount: 1, unit: units.value[0] ?? 'days', direction: 'after' }), ...patch }
  if (next.unit !== 'days' || !next.at) delete next.at
  setAtom({ timing: next })
}
const timingHint = computed(() => {
  if (!atom.value.timing || !def.value) return ''
  if (def.value.kind === 'event') return t('. The "only if" filters are asked again when the wait ends.', '. Los filtros «solo si» se vuelven a comprobar al acabar la espera.')
  if (key.value === 'appointment.start' && atom.value.timing.at) return t(", clinic time. Checked from that time for 20 minutes.", ', hora de la clínica. Se comprueba desde esa hora durante 20 minutos.')
  return ''
})
const lockedLead = computed(() => b.isLead.value && !b.hasGrowth.value)
const totals = computed(() => b.stats.value.rule)

function setFilters(filters: Record<string, any>) {
  b.updateRule({ filters })
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

// "Reaches a date on their record": the clinic's own date fields
// (Settings > Patient fields).
const supabase = useSupabaseClient()
const dateFields = ref<{ id: string; label: string }[]>([])
watch(
  key,
  async (k) => {
    if (k !== 'patient.date_field' || dateFields.value.length) return
    const { data } = await supabase.from('patient_attributes').select('id, label').eq('kind', 'date').is('archived_at', null).order('position')
    dateFields.value = (data ?? []) as { id: string; label: string }[]
  },
  { immediate: true },
)

// Who a group goes to: patients matching filters, a saved list or segment
// (with others left out), or patients chosen one by one. The mode is shown
// before anything is chosen in it, so it is held here and read back from the
// segment when it has something in it.
type WhoMode = 'filters' | 'saved' | 'patients'
const whoChoice = ref<WhoMode | null>(null)
watch(() => atom.value.subject, () => (whoChoice.value = null))
const who = computed<WhoMode>(() => (segment.value.audience ? 'saved' : segment.value.patient_ids?.length ? 'patients' : (whoChoice.value ?? 'filters')))
const savedAudienceMode = computed(() => who.value === 'saved')
function setWho(mode: WhoMode) {
  whoChoice.value = mode
  // Each mode clears the others, so what the send names is exactly what is on screen.
  if (mode === 'filters') setSegment({ audience: null, exclude: [], patient_ids: [] })
  if (mode === 'saved') setSegment({ patient_ids: [] })
  if (mode === 'patients') setSegment({ audience: null, exclude: [], filters: {} })
}
// A send opened with people already chosen (from the Patients page) stays in
// that mode when the last of them is taken off, rather than turning into
// "Patients who…" with no filters.
watch(
  () => segment.value.patient_ids?.length ?? 0,
  (n) => {
    if (n > 0) whoChoice.value = 'patients'
  },
  { immediate: true },
)
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

const preview = ref<{ count: number; chosen?: number | null; alreadyIn: number; whatsapp: number; email: number; sample: { id: string; name: string }[] } | null>(null)
const previewing = ref(false)
const showSample = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | undefined
async function refreshPreview() {
  if (!isSegment.value) return
  // Nobody chosen yet is nobody, not "no filters" (everyone).
  if (who.value === 'patients' && !segment.value.patient_ids?.length) {
    preview.value = { count: 0, chosen: null, alreadyIn: 0, whatsapp: 0, email: 0, sample: [] }
    return
  }
  previewing.value = true
  try {
    preview.value = await useStaffFetch('/api/automations/segment-preview', {
      method: 'POST',
      body: { filters: segment.value.filters ?? {}, audience: segment.value.audience ?? null, exclude: segment.value.exclude ?? [], patientIds: segment.value.patient_ids ?? [], isMarketing: rule.value.is_marketing, ruleId: b.ruleId.value, entryMode: rule.value.entry_mode },
    })
  } catch {
    preview.value = null
  } finally {
    previewing.value = false
  }
}
watch(
  () => [isSegment.value, JSON.stringify(segment.value.filters), JSON.stringify(segment.value.audience ?? null), JSON.stringify(segment.value.exclude ?? []), JSON.stringify(segment.value.patient_ids ?? []), rule.value.is_marketing, who.value],
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
      <NuxtLink to="/growth" class="inline-flex h-9 items-center self-start rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11">{{ t('See Growth', 'Ver Growth') }}</NuxtLink>
      <p :class="HINT">{{ t('This automation is paused and kept exactly as it is. It works again as soon as Growth is on.', 'Esta automatización está pausada y guardada tal cual. Vuelve a funcionar al activar Growth.') }}</p>
    </div>

    <div class="grid grid-cols-2 gap-2.5">
      <label :class="LABEL">
        {{ t('When…', 'Cuando…') }}
        <select :class="FIELD" :value="atom.subject" data-test="trigger-subject" @change="chooseSubject(($event.target as HTMLSelectElement).value)">
          <option v-for="s in TRIGGER_SUBJECTS" :key="s.subject" :value="s.subject" :disabled="s.growth && !b.hasGrowth.value && atom.subject !== s.subject">{{ say(t, s.label) }}{{ s.growth ? ' · GROWTH' : '' }}</option>
          <option value="group">{{ t('A group of patients (a send)', 'Un grupo de pacientes (un envío)') }}</option>
        </select>
      </label>
      <label v-if="!isSegment" :class="LABEL">
        <span class="invisible" aria-hidden="true">·</span>
        <select :class="FIELD" :value="atom.moment" :aria-label="t('What happens', 'Qué ocurre')" data-test="trigger-moment" @change="chooseMoment(($event.target as HTMLSelectElement).value)">
          <option v-for="m in momentsOf(atom.subject)" :key="m.moment" :value="m.moment">{{ say(t, m.label) }}</option>
        </select>
      </label>
    </div>
    <p v-if="def && !isSegment" :class="HINT">{{ say(t, def.hint) }}</p>

    <!-- When, relative to the moment -->
    <div v-if="def && !isSegment" class="flex flex-col gap-2" data-test="trigger-timing">
      <span v-if="def.kind !== 'date'" :class="SEGMENT_WRAP" role="group" :aria-label="t('When it starts', 'Cuándo empieza')">
        <button type="button" :class="segmentBtn(!atom.timing)" :aria-pressed="!atom.timing" data-test="trigger-timing-now" @click="setTimed(false)">{{ t('As it happens', 'En el momento') }}</button>
        <button type="button" :class="segmentBtn(!!atom.timing)" :aria-pressed="!!atom.timing" data-test="trigger-timing-later" @click="setTimed(true)">{{ def.kind === 'event' ? t('Some time later', 'Un tiempo después') : t('Counting from its date', 'Contando desde su fecha') }}</button>
      </span>
      <div v-if="atom.timing" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
        <input type="number" min="0" :class="FIELD_NUMBER" :value="atom.timing.amount" :aria-label="t('How long', 'Cuánto')" data-test="trigger-amount" @input="setTiming({ amount: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
        <select :class="[FIELD, 'w-28']" :value="atom.timing.unit" :aria-label="t('Unit', 'Unidad')" data-test="trigger-unit" @change="setTiming({ unit: ($event.target as HTMLSelectElement).value as TimingUnit })">
          <option v-for="u in units" :key="u" :value="u">{{ unitLabel(u) }}</option>
        </select>
        <span v-if="directions.length > 1" :class="SEGMENT_WRAP" role="group" :aria-label="t('Before or after', 'Antes o después')">
          <button type="button" :class="segmentBtn(atom.timing.direction === 'before')" :aria-pressed="atom.timing.direction === 'before'" data-test="trigger-before" @click="setTiming({ direction: 'before' })">{{ t('before', 'antes') }}</button>
          <button type="button" :class="segmentBtn(atom.timing.direction === 'after')" :aria-pressed="atom.timing.direction === 'after'" data-test="trigger-after" @click="setTiming({ direction: 'after' })">{{ t('after', 'después') }}</button>
        </span>
        <span v-else>{{ t('after', 'después') }}</span>
      </div>
      <label v-if="atom.timing && def.allowsAt && atom.timing.unit === 'days'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
        <input type="checkbox" class="h-4 w-4 accent-brand" :checked="!!atom.timing.at" data-test="trigger-at-on" @change="setTiming({ at: ($event.target as HTMLInputElement).checked ? '09:00' : null })" />
        {{ t('At a time of day', 'A una hora del día') }}
        <input v-if="atom.timing.at" type="time" step="300" :class="[FIELD, 'w-28']" :value="atom.timing.at" data-test="trigger-at" @change="setTiming({ at: ($event.target as HTMLInputElement).value || '09:00' })" />
      </label>
      <p v-if="atom.timing" :class="HINT" data-test="trigger-timing-text">{{ timingText(t, atom, rule.filters) }}{{ timingHint }}</p>
    </div>

    <!-- The moment's own setting -->
    <label v-if="key === 'appointment.completed'" class="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700 touch:min-h-11">
      <input type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" :checked="atom.send_to === 'referrer'" data-test="trigger-send-to-referrer" @change="setSendTo(($event.target as HTMLInputElement).checked)" />
      <span>
        {{ t('Send it to whoever referred them', 'Enviarla a quien le refirió') }}
        <span :class="['block', HINT]">{{ t('For thanking a referrer once the person they sent has come in. The filters still look at the referred patient and their visit: "Visit number" = first for the first visit only.', 'Para dar las gracias a quien refirió cuando ha venido la persona que envió. Los filtros siguen mirando al paciente referido y su cita: «Número de visita» = primera para solo la primera.') }}</span>
      </span>
    </label>
    <label v-if="key === 'patient.tag_added' || key === 'patient.tag_removed'" :class="LABEL">
      {{ t('Which tag', 'Qué etiqueta') }}
      <input :class="FIELD" :value="atom.options.trigger_tag ?? ''" :placeholder="t('Any tag', 'Cualquier etiqueta')" data-test="trigger-tag" @input="setOptions({ trigger_tag: ($event.target as HTMLInputElement).value })" />
      <span :class="HINT">{{ t('Capitals do not matter. Left empty, any tag starts it.', 'Da igual mayúsculas o minúsculas. Si se deja vacía, la inicia cualquier etiqueta.') }}</span>
    </label>
    <label v-if="key === 'patient.type_added' || key === 'patient.type_removed'" :class="LABEL">
      {{ t('Which type', 'Qué tipo') }}
      <select
        :class="FIELD"
        :value="atom.options.trigger_type_id ?? ''"
        data-test="trigger-patient-type"
        @change="
          setOptions({
            trigger_type_id: ($event.target as HTMLSelectElement).value || undefined,
            trigger_type_name: (b.lookup.value.patientTypes ?? []).find((x) => x.id === ($event.target as HTMLSelectElement).value)?.name || undefined,
          })
        "
      >
        <option value="">{{ t('Any type', 'Cualquier tipo') }}</option>
        <option v-for="ty in b.lookup.value.patientTypes ?? []" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
      </select>
      <span :class="HINT">{{ t('Patient types are set up in Settings > Patient types.', 'Los tipos de paciente se crean en Ajustes › Tipos de paciente.') }}</span>
    </label>
    <div v-if="key === 'rating.answered'" :class="LABEL">
      {{ t('With a score of', 'Con una nota de') }}
      <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Score', 'Nota')">
        <button v-for="o in [{ v: '', l: t('Any', 'Cualquiera') }, { v: 'high', l: '4-5' }, { v: 'low', l: '1-3' }]" :key="o.v" type="button" :class="segmentBtn((atom.options.trigger_score ?? '') === o.v)" :aria-pressed="(atom.options.trigger_score ?? '') === o.v" :data-test="`trigger-score-${o.v || 'any'}`" @click="setOptions({ trigger_score: o.v || undefined })">{{ o.l }}</button>
      </span>
    </div>
    <div v-if="key === 'form.completed' || key === 'form.sent'" :class="LABEL">
      {{ t('Which forms', 'Qué formularios') }}
      <AutomationsMultiPick
        :model-value="(atom.options.trigger_doc_template_ids as string[] | undefined) ?? []"
        :options="b.docTemplates.value.map((d) => ({ value: d.id, label: d.title }))"
        :placeholder="t('Any form', 'Cualquier formulario')"
        test-id="trigger-doc-templates"
        @update:model-value="setOptions({ trigger_doc_template_ids: $event.length ? $event : undefined })"
      />
      <span :class="HINT">{{ t('Forms from before it is switched on, or more than two days ago, do not start it.', 'Los formularios de antes de activarla, o de hace más de dos días, no la inician.') }}</span>
    </div>
    <label v-if="key === 'lead.stage_changed'" :class="LABEL">
      {{ t('Moved to', 'Movido a') }}
      <select :class="FIELD" :value="atom.options.trigger_lead_stage ?? ''" data-test="trigger-lead-stage" @change="setOptions({ trigger_lead_stage: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">{{ t('Any stage', 'Cualquier etapa') }}</option>
        <option v-for="o in LEAD_STAGE_OPTIONS.filter((x) => !LEAD_STOP_STAGES.includes(x.value))" :key="o.value" :value="o.value">{{ say(t, o.label) }}</option>
      </select>
      <span :class="HINT">{{ t('Each lead enters once. Not offered: Patient and Lost, because automations stop for a lead in either. A booking moving the lead to "Booked" by itself does not count; for that, use "Wait until they book" in a New lead automation.', 'Cada lead entra una vez. No se ofrecen Paciente ni Perdido, porque las automatizaciones se detienen para un lead en cualquiera de las dos. Que una reserva lo pase sola a «Con cita» no cuenta; para eso, usa «Esperar hasta que reserve» en una automatización de Lead nuevo.') }}</span>
    </label>
    <label v-if="key === 'patient.date_field'" :class="LABEL">
      {{ t('Which date', 'Qué fecha') }}
      <select :class="FIELD" :value="atom.options.trigger_date ?? ''" data-test="trigger-date-field" @change="setOptions({ trigger_date: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="" disabled>{{ dateFields.length ? t('Choose a date field', 'Elige un campo de fecha') : t('No date fields yet (Settings > Patient fields)', 'Aún no hay campos de fecha (Ajustes › Campos del paciente)') }}</option>
        <option v-for="f in dateFields" :key="f.id" :value="`field:${f.id}`">{{ f.label }}</option>
      </select>
    </label>
    <template v-if="key === 'patient.entered_audience'">
      <div :class="LABEL">
        {{ t('The list or segment', 'La lista o el segmento') }}
        <AutomationsAudiencePicker :model-value="(atom.options.trigger_audience as AudienceRef | undefined) ?? null" test-id="trigger-audience" @update:model-value="setOptions({ trigger_audience: $event ?? undefined })" />
      </div>
      <label class="flex cursor-pointer items-start gap-2 text-[13px] text-ink-700 touch:min-h-11">
        <input type="checkbox" class="mt-0.5 h-4 w-4 accent-brand" :checked="atom.options.include_current === true" data-test="trigger-include-current" @change="setOptions({ include_current: ($event.target as HTMLInputElement).checked || undefined })" />
        <span>
          {{ t('Also the people already in it, when it is switched on', 'También quienes ya están, al activarla') }}
          <span :class="['block', HINT]">{{ t('Otherwise only those who enter from then on. Paused and switched back on, it carries on from that moment: whoever entered meanwhile is not enrolled late.', 'Si no, solo los que entren desde entonces. Si se pausa y se vuelve a activar, sigue desde ese momento: quienes entraron mientras tanto no se inscriben tarde.') }}</span>
        </span>
      </label>
    </template>
    <template v-if="key === 'care_plan.milestone'">
      <div :class="LABEL">
        {{ t('When', 'Cuándo') }}
        <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Milestone', 'Hito')">
          <button v-for="o in [{ v: '', l: t('Re-exam is next', 'Toca revisión') }, { v: 'finished', l: t('Plan finished', 'Plan terminado') }, { v: 'visit', l: t('Visit number', 'Visita número') }]" :key="o.v" type="button" :class="segmentBtn((atom.options.trigger_milestone ?? '') === o.v)" :aria-pressed="(atom.options.trigger_milestone ?? '') === o.v" :data-test="`trigger-milestone-${o.v || 'reexam'}`" @click="setOptions({ trigger_milestone: o.v || undefined })">{{ o.l }}</button>
        </span>
        <span :class="HINT">{{ (atom.options.trigger_milestone ?? '') === '' ? t('After the visit before one the plan marks as a re-exam, so it can be booked in time.', 'Tras la visita anterior a una que el plan marca como revisión, para que dé tiempo a reservarla.') : atom.options.trigger_milestone === 'finished' ? t("After the plan's last visit.", 'Tras la última visita del plan.') : t('After that visit of the plan, counting as the plan does: no cancelled or missed ones.', 'Tras esa visita del plan, contando como el plan: sin las canceladas ni las de no asistió.') }}</span>
      </div>
      <label v-if="atom.options.trigger_milestone === 'visit'" :class="LABEL">
        {{ t('Visit number', 'Visita número') }}
        <input type="number" min="1" :class="FIELD_NUMBER" :value="atom.options.trigger_visit_number ?? 6" data-test="trigger-visit-number" @input="setOptions({ trigger_visit_number: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 1)) })" />
      </label>
    </template>
    <div v-if="key === 'bono.running_low'" :class="LABEL">
      {{ t('Sessions left', 'Sesiones restantes') }}
      <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Sessions left', 'Sesiones restantes')">
        <button v-for="n in [0, 1, 2, 3]" :key="n" type="button" :class="segmentBtn((atom.options.trigger_sessions_left ?? 1) === n)" :aria-pressed="(atom.options.trigger_sessions_left ?? 1) === n" :data-test="`trigger-sessions-left-${n}`" @click="setOptions({ trigger_sessions_left: n })">{{ n === 0 ? t('Used up', 'Agotado') : n }}</button>
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
          <button type="button" :class="segmentBtn(who === 'filters')" :aria-pressed="who === 'filters'" data-test="segment-who-filters" @click="setWho('filters')">{{ t('Patients who…', 'Pacientes que…') }}</button>
          <button type="button" :class="segmentBtn(who === 'saved')" :aria-pressed="who === 'saved'" data-test="segment-who-saved" @click="setWho('saved')">{{ t('A list or segment', 'Una lista o un segmento') }}</button>
          <button type="button" :class="segmentBtn(who === 'patients')" :aria-pressed="who === 'patients'" data-test="segment-who-patients" @click="setWho('patients')">{{ t('Specific patients', 'Pacientes concretos') }}</button>
        </span>
      </div>
      <AutomationsPatientPicker v-if="who === 'patients'" :model-value="segment.patient_ids ?? []" @update:model-value="setSegment({ patient_ids: $event })" />
      <div v-if="savedAudienceMode" class="flex flex-col gap-2.5">
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
      <div v-if="who === 'filters'" class="flex flex-col gap-2">
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
        <p v-if="preview?.chosen && preview.chosen > preview.count" :class="HINT" data-test="segment-count-left-out">
          {{ t(`${preview.chosen - preview.count} of the ${preview.chosen} chosen cannot receive it: no consent for this kind of message, archived, a minor or not to be contacted.`, `${preview.chosen - preview.count} de los ${preview.chosen} elegidos no pueden recibirlo: sin consentimiento para este tipo de mensaje, archivados, menores o «no contactar».`) }}
        </p>
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
          :atom="atom"
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
