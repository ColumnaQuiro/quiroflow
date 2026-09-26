<script setup lang="ts">
import { FILTERS, FILTER_KEYS, defaultFilterValue, filtersInUse, say, type FilterKey } from '~/utils/automationCatalog'
import { FIELD, FIELD_NUMBER, HINT, LINK_BTN, REMOVE_BTN } from '~/utils/automationUi'

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
  testPrefix?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, any>] }>()

const t = useT()
const b = useBuilder()

const used = computed(() => filtersInUse(props.modelValue))
const offered = computed(() =>
  FILTERS.filter((f) => (props.mode === 'segment' ? f.segment : f.appointment ? props.appointmentContext : true)).filter((f) => !used.value.includes(f.key)),
)
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

const typeOptions = computed(() => {
  const ids: string[] = props.modelValue.appointment_type_ids ?? (props.modelValue.appointment_type_id ? [props.modelValue.appointment_type_id] : [])
  // Archived types are not offered for a new filter, but one the rule already
  // uses stays listed (ticked, marked) -- dropping it would untick it on the
  // next save and silently widen the rule to every other type.
  return (b.lookup.value.appointmentTypes as { id: string; name: string; archived_at?: string | null }[])
    .filter((x) => !x.archived_at || ids.includes(x.id))
    .map((x) => ({ value: x.id, label: x.archived_at ? `${x.name} (${t('archived', 'archivado')})` : x.name, muted: !!x.archived_at }))
})
const typeIds = computed<string[]>(() => props.modelValue.appointment_type_ids ?? (props.modelValue.appointment_type_id ? [props.modelValue.appointment_type_id] : []))
function setTypes(ids: string[]) {
  // The legacy single-type key goes the moment the list is edited.
  const next: Record<string, any> = { ...props.modelValue, appointment_type_ids: ids }
  delete next.appointment_type_id
  emit('update:modelValue', next)
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
      </div>
      <button type="button" :class="REMOVE_BTN" :aria-label="t('Remove filter', 'Quitar filtro')" @click="remove(key)">✕</button>
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
