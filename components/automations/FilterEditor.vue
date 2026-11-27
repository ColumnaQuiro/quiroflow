<script setup lang="ts">
import { APPOINTMENT_SOURCE_OPTIONS, APPOINTMENT_STATUS_OPTIONS, CONSENT_CHANNEL_OPTIONS, FILTERS, FILTER_KEYS, defaultFilterValue, filtersInUse, say, type FilterKey } from '~/utils/automationCatalog'
import type { TriggerAtom } from '~/utils/automationTrigger'
import { FIELD, FIELD_NUMBER, HINT, LINK_BTN, REMOVE_BTN } from '~/utils/automationUi'
import { asAudienceRefs, type AudienceRef } from '~/utils/automationAudience'

// "Only if…" under a trigger, and "Patients who…" under a segment: rows of
// filter, comparison, value. Writes the same keys into automation_rules.filters
// (or segment.filters) that evaluateAutomationFilters reads -- the old
// Campaigns editor's set, plus last visit and location for segments -- and
// keeps any key it does not show, so opening an old rule and saving it never
// quietly widens who it reaches.

const props = defineProps<{
  modelValue: Record<string, any>
  mode: 'trigger' | 'segment'
  appointmentContext: boolean
  /** The trigger, for the filters only some moments offer ("Still unpaid" for an invoice). */
  atom?: TriggerAtom | null
  testPrefix?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()

const t = useT()
const b = useBuilder()

const used = computed(() => filtersInUse(props.modelValue))
const momentKey = computed(() => (props.atom ? `${props.atom.subject}.${props.atom.moment}` : ''))
const offered = computed(() =>
  FILTERS.filter((f) => (props.mode === 'segment' ? f.segment : f.appointment ? props.appointmentContext : true))
    .filter((f) => !f.moments || f.moments.includes(momentKey.value))
    .filter((f) => !(f.noAppointment && props.mode === 'trigger' && props.appointmentContext))
    .filter((f) => !used.value.includes(f.key)),
)
const intOrUndefined = (raw: string) => (raw.trim() === '' ? undefined : Math.max(0, Math.round(Number(raw) || 0)))
const visitNumber = computed(() => (props.modelValue.visit_number && typeof props.modelValue.visit_number === 'object' ? props.modelValue.visit_number : { first: true, every: 0 }))
const label = (key: FilterKey) => say(t, FILTERS.find((f) => f.key === key)!.label)

function set(patch: Record<string, any>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}
function remove(key: FilterKey) {
  const next = { ...props.modelValue }
  for (const k of FILTER_KEYS[key]) delete next[k]
  emit('update:modelValue', next)
}
const adding = ref('')
function add(key: string) {
  if (!key) return
  set(defaultFilterValue(key as FilterKey))
  adding.value = ''
}

// Archived types are not offered for a new filter, but one the rule already
// uses stays listed (ticked, marked) -- dropping it would untick it on the
// next save and silently widen the rule to every other type. A visit of an
// archived type is still history, so "Tipo de visita" keeps them the same way.
function appointmentTypeOptions(ids: string[]) {
  return (b.lookup.value.appointmentTypes as { id: string; name: string; archived_at?: string | null }[])
    .filter((x) => !x.archived_at || ids.includes(x.id))
    .map((x) => ({ value: x.id, label: x.archived_at ? `${x.name} (${t('archived', 'archivado')})` : x.name, muted: !!x.archived_at }))
}
const typeIds = computed<string[]>(() => props.modelValue.appointment_type_ids ?? (props.modelValue.appointment_type_id ? [props.modelValue.appointment_type_id] : []))
const typeOptions = computed(() => appointmentTypeOptions(typeIds.value))
const visitTypeIds = computed<string[]>(() => (Array.isArray(props.modelValue.visit_type_ids) ? props.modelValue.visit_type_ids : []))
const visitTypeOptions = computed(() => appointmentTypeOptions(visitTypeIds.value))
function setTypes(ids: string[]) {
  // The legacy single-type key goes the moment the list is edited.
  const next: Record<string, any> = { ...props.modelValue, appointment_type_ids: ids }
  delete next.appointment_type_id
  emit('update:modelValue', next)
}

// "In a list or segment": two lists of audiences, any-of and none-of, each
// with an empty picker at the end to add one more.
function audienceRefs(key: 'in_audiences' | 'not_in_audiences'): AudienceRef[] {
  return asAudienceRefs(props.modelValue[key])
}
function setAudience(key: 'in_audiences' | 'not_in_audiences', i: number, ref: AudienceRef | null) {
  const next = [...audienceRefs(key)]
  if (ref) next[i] = ref
  else next.splice(i, 1)
  set({ [key]: next })
}

const lastVisitUnit = ref<'months' | 'days'>(Number(props.modelValue.last_visit_before_days) % 30 === 0 ? 'months' : 'days')
const lastVisitValue = computed(() => {
  const days = Number(props.modelValue.last_visit_before_days) || 0
  return lastVisitUnit.value === 'months' ? Math.round(days / 30) : days
})
function setLastVisit(value: number, unit = lastVisitUnit.value) {
  lastVisitUnit.value = unit
  set({ last_visit_before_days: Math.max(1, Math.round(value || 1)) * (unit === 'months' ? 30 : 1) })
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div v-for="key in used" :key="key" class="flex items-start gap-2" :data-test="`${testPrefix ?? 'filter'}-${key}`">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle p-2.5">
        <span class="text-[12px] font-semibold text-ink-700">{{ label(key) }}</span>

        <AutomationsMultiPick
          v-if="key === 'appointment_types'"
          :model-value="typeIds"
          :options="typeOptions"
          :placeholder="t('Any type', 'Cualquier tipo')"
          @update:model-value="setTypes"
        />
        <template v-else-if="key === 'visit_types'">
          <AutomationsMultiPick
            :model-value="visitTypeIds"
            :options="visitTypeOptions"
            :placeholder="t('Choose types', 'Elige tipos')"
            :test-id="`${testPrefix ?? 'filter'}-visit-types`"
            @update:model-value="set({ visit_type_ids: $event })"
          />
          <span :class="HINT">{{ t('Has had at least one completed visit of any of these types. The visit-count and last-visit filters then count only these.', 'Ha tenido al menos una visita completada de alguno de estos tipos. Los filtros de número de visitas y última visita cuentan entonces solo estas.') }}</span>
        </template>
        <AutomationsMultiPick
          v-else-if="key === 'practitioners'"
          :model-value="modelValue.practitioner_ids ?? []"
          :options="b.lookup.value.practitioners.map((p) => ({ value: p.id, label: p.full_name }))"
          :placeholder="t('Any practitioner', 'Cualquier profesional')"
          @update:model-value="set({ practitioner_ids: $event })"
        />
        <div v-else-if="key === 'total_visits'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('exactly', 'exactamente') }}</span>
          <input type="number" min="0" :class="FIELD_NUMBER" :value="modelValue.total_visits" :aria-label="label(key)" @input="set({ total_visits: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
          <span :class="HINT">{{ t('completed visits (of the chosen types, if any)', 'visitas completadas (de los tipos elegidos, si hay)') }}</span>
        </div>
        <p v-else-if="key === 'no_prior_appointments'" :class="HINT">{{ t('No other appointments at all, past or future.', 'Sin ninguna otra cita, ni pasada ni futura.') }}</p>
        <select
          v-else-if="key === 'has_future_appointment'"
          :class="FIELD"
          :value="modelValue.has_future_appointment ? 'yes' : 'no'"
          :aria-label="label(key)"
          @change="set({ has_future_appointment: ($event.target as HTMLSelectElement).value === 'yes' })"
        >
          <option value="yes">{{ t('has one', 'existe') }}</option>
          <option value="no">{{ t('has none', 'no existe') }}</option>
        </select>
        <div v-else-if="key === 'last_visit'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('more than', 'hace más de') }}</span>
          <input type="number" min="1" :class="FIELD_NUMBER" :value="lastVisitValue" :aria-label="label(key)" @input="setLastVisit(Number(($event.target as HTMLInputElement).value))" />
          <select :class="[FIELD, 'w-28']" :value="lastVisitUnit" :aria-label="t('Unit', 'Unidad')" @change="setLastVisit(lastVisitValue, ($event.target as HTMLSelectElement).value as 'months' | 'days')">
            <option value="months">{{ t('months', 'meses') }}</option>
            <option value="days">{{ t('days', 'días') }}</option>
          </select>
          <span :class="HINT">{{ t('ago', 'atrás') }}</span>
        </div>
        <div v-else-if="key === 'last_visit_within'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('at most', 'como mucho') }}</span>
          <input type="number" min="1" :class="FIELD_NUMBER" :value="Number(modelValue.last_visit_within_days) || 1" :aria-label="label(key)" @input="set({ last_visit_within_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 1)) })" />
          <span :class="HINT">{{ t('days ago (with "Last visit", a band)', 'días atrás (con «Última visita», una franja)') }}</span>
        </div>
        <div v-else-if="key === 'min_visits'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('at least', 'al menos') }}</span>
          <input type="number" min="0" :class="FIELD_NUMBER" :value="modelValue.min_visits" :aria-label="label(key)" @input="set({ min_visits: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
          <span :class="HINT">{{ t('completed visits', 'visitas completadas') }}</span>
        </div>
        <div v-else-if="key === 'max_visits'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('at most', 'como mucho') }}</span>
          <input type="number" min="0" :class="FIELD_NUMBER" :value="modelValue.max_visits" :aria-label="label(key)" @input="set({ max_visits: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
          <span :class="HINT">{{ t('completed visits', 'visitas completadas') }}</span>
        </div>
        <div v-else-if="key === 'no_whatsapp_sent'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('nothing sent in the last', 'sin ningún envío en los últimos') }}</span>
          <input type="number" min="1" :class="FIELD_NUMBER" :value="Number(modelValue.no_whatsapp_sent_days) || 1" :aria-label="label(key)" @input="set({ no_whatsapp_sent_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 1)) })" />
          <span :class="HINT">{{ t('days, by anyone or any automation', 'días, por nadie ni por otra automatización') }}</span>
        </div>
        <div v-else-if="key === 'care_plan_overdue'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700" data-cy="filter-care-plan-overdue">
          <span>{{ t('a visit overdue by', 'una visita atrasada') }}</span>
          <input type="number" min="1" :class="FIELD_NUMBER" :value="Number(modelValue.care_plan_overdue_days) || 1" :aria-label="label(key)" @input="set({ care_plan_overdue_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 1)) })" />
          <span :class="HINT">{{ t('days or more, nothing booked', 'días o más, sin cita') }}</span>
        </div>
        <input
          v-else-if="key === 'tag_contains'"
          type="text"
          :class="FIELD"
          :value="modelValue.tag_contains"
          :placeholder="t('Tag contains…', 'La etiqueta contiene…')"
          :aria-label="label(key)"
          @input="set({ tag_contains: ($event.target as HTMLInputElement).value })"
        />
        <select v-else-if="key === 'balance'" :class="FIELD" :value="modelValue.balance" :aria-label="label(key)" @change="set({ balance: ($event.target as HTMLSelectElement).value })">
          <option value="debit">{{ t('Owes money', 'Debe dinero') }}</option>
          <option value="credit">{{ t('In credit', 'Con saldo a favor') }}</option>
        </select>
        <AutomationsMultiPick
          v-else-if="key === 'membership'"
          :model-value="modelValue.membership_ids ?? []"
          :options="b.lookup.value.memberships.map((m) => ({ value: m.id, label: m.name }))"
          :placeholder="t('Any active membership', 'Cualquier membresía activa')"
          @update:model-value="set({ membership_active: true, membership_ids: $event.length ? $event : undefined })"
        />
        <AutomationsMultiPick
          v-else-if="key === 'clinics'"
          :model-value="modelValue.clinic_ids ?? []"
          :options="b.lookup.value.clinics.map((c) => ({ value: c.id, label: c.name }))"
          :placeholder="t('Choose locations', 'Elige sedes')"
          @update:model-value="set({ clinic_ids: $event })"
        />
        <div v-else-if="key === 'audience'" class="flex flex-col gap-2 text-[13px] text-ink-700" data-test="filter-audience">
          <span>{{ t('Is in any of', 'Está en alguna de') }}</span>
          <AutomationsAudiencePicker
            v-for="(a, i) in [...audienceRefs('in_audiences'), null]"
            :key="a ? `in:${a.kind}:${a.id}` : `in-new-${audienceRefs('in_audiences').length}`"
            :model-value="a"
            :test-id="`${testPrefix ?? 'filter'}-audience-in-${i}`"
            @update:model-value="setAudience('in_audiences', i, $event)"
          />
          <span>{{ t('and is not in', 'y no está en') }}</span>
          <AutomationsAudiencePicker
            v-for="(a, i) in [...audienceRefs('not_in_audiences'), null]"
            :key="a ? `out:${a.kind}:${a.id}` : `out-new-${audienceRefs('not_in_audiences').length}`"
            :model-value="a"
            :placeholder="a ? undefined : t('Nobody left out', 'Sin excluir a nadie')"
            :test-id="`${testPrefix ?? 'filter'}-audience-out-${i}`"
            @update:model-value="setAudience('not_in_audiences', i, $event)"
          />
          <span :class="HINT">{{ t('Checked when it fires. A segment is who matched it at its last refresh (every 15 minutes, and when it is saved).', 'Se comprueba al dispararse. Un segmento es quien coincidía en su último refresco (cada 15 minutos, y al guardarlo).') }}</span>
        </div>
        <AutomationsMultiPick
          v-else-if="key === 'appointment_status'"
          :model-value="modelValue.appointment_statuses ?? []"
          :options="APPOINTMENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: say(t, o.label) }))"
          :placeholder="t('Choose statuses', 'Elige estados')"
          :test-id="`${testPrefix ?? 'filter'}-appointment-statuses`"
          @update:model-value="set({ appointment_statuses: $event })"
        />
        <AutomationsMultiPick
          v-else-if="key === 'appointment_source'"
          :model-value="modelValue.appointment_sources ?? []"
          :options="APPOINTMENT_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: say(t, o.label) }))"
          :placeholder="t('Anyone', 'Cualquiera')"
          @update:model-value="set({ appointment_sources: $event })"
        />
        <AutomationsMultiPick
          v-else-if="key === 'appointment_location'"
          :model-value="modelValue.appointment_clinic_ids ?? []"
          :options="b.lookup.value.clinics.map((c) => ({ value: c.id, label: c.name }))"
          :placeholder="t('Choose locations', 'Elige sedes')"
          @update:model-value="set({ appointment_clinic_ids: $event })"
        />
        <p v-else-if="key === 'reminder_unanswered'" :class="HINT">{{ t('Not if they already confirmed this appointment or asked to change it, answering a reminder. Confirming when it was booked does not count.', 'No si ya confirmó esta cita o pidió cambiarla al contestar un recordatorio. Confirmar al reservarla no cuenta.') }}</p>
        <div v-else-if="key === 'visit_number'" class="flex flex-col gap-1.5 text-[13px] text-ink-700">
          <label class="flex items-center gap-2">
            <input type="checkbox" class="h-4 w-4 accent-brand" :checked="visitNumber.first !== false" :data-test="`${testPrefix ?? 'filter'}-visit-first`" @change="set({ visit_number: { ...visitNumber, first: ($event.target as HTMLInputElement).checked } })" />
            {{ t('Their first visit', 'Su primera visita') }}
          </label>
          <span class="flex flex-wrap items-center gap-2">
            {{ t('and every', 'y cada') }}
            <input type="number" min="0" :class="FIELD_NUMBER" :value="visitNumber.every ?? 0" :aria-label="t('Every how many visits', 'Cada cuántas visitas')" :data-test="`${testPrefix ?? 'filter'}-visit-every`" @input="set({ visit_number: { ...visitNumber, every: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) } })" />
            <span :class="HINT">{{ t('visits (0 = never), this one included', 'visitas (0 = nunca), contando esta') }}</span>
          </span>
        </div>
        <div v-else-if="key === 'not_rated'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('not asked "how did we do?" in the last', 'sin preguntarle «¿qué tal te hemos atendido?» en los últimos') }}</span>
          <input type="number" min="1" :class="FIELD_NUMBER" :value="Number(modelValue.not_rated_days) || 30" :aria-label="label(key)" @input="set({ not_rated_days: Math.max(1, Math.round(Number(($event.target as HTMLInputElement).value) || 30)) })" />
          <span :class="HINT">{{ t('days, by any automation', 'días, por ninguna automatización') }}</span>
        </div>
        <p v-else-if="key === 'invoice_unpaid'" :class="HINT">{{ t('Only invoices still owed (50 cents or more), of patients whose payment reminders are not paused.', 'Solo facturas con algo pendiente (50 céntimos o más), de pacientes con los recordatorios de pago sin pausar.') }}</p>
        <AutomationsMultiPick
          v-else-if="key === 'patient_types'"
          :model-value="modelValue.patient_type_ids ?? []"
          :options="(b.lookup.value.patientTypes ?? []).map((x) => ({ value: x.id, label: x.name }))"
          :placeholder="t('Any of these types', 'Alguno de estos tipos')"
          @update:model-value="set({ patient_type_ids: $event })"
        />
        <div v-else-if="key === 'age'" class="flex flex-wrap items-center gap-2 text-[13px] text-ink-700">
          <span>{{ t('from', 'de') }}</span>
          <input type="number" min="0" :class="FIELD_NUMBER" :value="modelValue.age_min ?? ''" :placeholder="t('any', 'cualquiera')" :aria-label="t('Minimum age', 'Edad mínima')" @input="set({ age_min: intOrUndefined(($event.target as HTMLInputElement).value) })" />
          <span>{{ t('to', 'a') }}</span>
          <input type="number" min="0" :class="FIELD_NUMBER" :value="modelValue.age_max ?? ''" :placeholder="t('any', 'cualquiera')" :aria-label="t('Maximum age', 'Edad máxima')" @input="set({ age_max: intOrUndefined(($event.target as HTMLInputElement).value) })" />
          <span :class="HINT">{{ t('years. Patients with no date of birth do not match.', 'años. Quien no tiene fecha de nacimiento no coincide.') }}</span>
        </div>
        <div v-else-if="key === 'contact'" class="grid grid-cols-2 gap-2 text-[13px] text-ink-700">
          <select :class="FIELD" :value="modelValue.has_email === undefined ? '' : String(modelValue.has_email)" :aria-label="t('Email', 'Email')" @change="set({ has_email: ($event.target as HTMLSelectElement).value === '' ? undefined : ($event.target as HTMLSelectElement).value === 'true' })">
            <option value="">{{ t('Email: either', 'Email: da igual') }}</option>
            <option value="true">{{ t('Has an email', 'Tiene email') }}</option>
            <option value="false">{{ t('No email', 'Sin email') }}</option>
          </select>
          <select :class="FIELD" :value="modelValue.has_phone === undefined ? '' : String(modelValue.has_phone)" :aria-label="t('Phone', 'Teléfono')" @change="set({ has_phone: ($event.target as HTMLSelectElement).value === '' ? undefined : ($event.target as HTMLSelectElement).value === 'true' })">
            <option value="">{{ t('Phone: either', 'Teléfono: da igual') }}</option>
            <option value="true">{{ t('Has a phone', 'Tiene teléfono') }}</option>
            <option value="false">{{ t('No phone', 'Sin teléfono') }}</option>
          </select>
        </div>
        <AutomationsMultiPick
          v-else-if="key === 'marketing_consent'"
          :model-value="modelValue.marketing_channels_any ?? []"
          :options="CONSENT_CHANNEL_OPTIONS.map((o) => ({ value: o.value, label: say(t, o.label) }))"
          :placeholder="t('Accepted any of', 'Aceptó alguno de')"
          @update:model-value="set({ marketing_channels_any: $event })"
        />
        <select v-else-if="key === 'care_plan_state'" :class="FIELD" :value="modelValue.care_plan_state" :aria-label="label(key)" @change="set({ care_plan_state: ($event.target as HTMLSelectElement).value })">
          <option value="active">{{ t('Has one running', 'Tiene uno en curso') }}</option>
          <option value="finished">{{ t('Finished their latest', 'Terminó el último') }}</option>
          <option value="none">{{ t('Has never had one', 'Nunca ha tenido') }}</option>
        </select>
        <select v-else-if="key === 'bono_active'" :class="FIELD" :value="modelValue.bono_active ? 'yes' : 'no'" :aria-label="label(key)" @change="set({ bono_active: ($event.target as HTMLSelectElement).value === 'yes' })">
          <option value="yes">{{ t('has one', 'tiene uno') }}</option>
          <option value="no">{{ t('has none', 'no tiene') }}</option>
        </select>
      </div>
      <button type="button" :class="REMOVE_BTN" :aria-label="t('Remove filter', 'Quitar filtro')" @click="remove(key)"><UiCloseIcon /></button>
    </div>

    <label v-if="offered.length > 0" class="flex items-center gap-2">
      <span class="sr-only">{{ t('Add filter', 'Añadir filtro') }}</span>
      <select v-model="adding" :class="[FIELD, 'w-auto']" :data-test="`${testPrefix ?? 'filter'}-add`" @change="add(adding)">
        <option value="" disabled>+ {{ t('Add filter', 'Añadir filtro') }}</option>
        <option v-for="f in offered" :key="f.key" :value="f.key">{{ say(t, f.label) }}</option>
      </select>
    </label>
    <p v-else-if="used.length === 0" :class="LINK_BTN">—</p>
  </div>
</template>
