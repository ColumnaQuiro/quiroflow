<script setup lang="ts">
import { FIELD, HINT, REMOVE_BTN } from '~/utils/automationUi'
import { MAX_PICKED_PATIENTS } from '~/utils/automationAudience'
import { normalizeSearchTerm, sanitizeSearchToken } from '~/utils/searchText'

// Patients chosen one by one, for a one-off send (segment.patient_ids): a
// search to add someone, and the chosen people with a way to take each off.
// Names are read through the caller's own client, so nobody they could not
// open is shown -- or offered.

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const t = useT()
const supabase = useSupabaseClient()

type Row = { id: string; first_name: string; last_name: string | null }
const fullName = (p: Row) => `${p.first_name} ${p.last_name ?? ''}`.trim()

// Names of the people already chosen. A long selection (from the Patients
// page) is shown as its first names and a count, not a wall of rows.
const SHOWN = 50
const names = ref(new Map<string, string>())
watch(
  () => props.modelValue.slice(0, SHOWN).join(','),
  async () => {
    const missing = props.modelValue.slice(0, SHOWN).filter((id) => !names.value.has(id))
    if (!missing.length) return
    const { data } = await supabase.from('patients').select('id, first_name, last_name').in('id', missing)
    const next = new Map(names.value)
    for (const p of (data ?? []) as Row[]) next.set(p.id, fullName(p))
    names.value = next
  },
  { immediate: true },
)

const query = ref('')
const results = ref<Row[]>([])
let token = 0
let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(debounce)
  const mine = ++token
  const term = sanitizeSearchToken(q.trim())
  if (!term) {
    results.value = []
    return
  }
  debounce = setTimeout(async () => {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').ilike('search_name', `%${normalizeSearchTerm(term)}%`).neq('status', 'inactive').order('first_name').limit(8)
    if (mine === token) results.value = ((data ?? []) as Row[]).filter((p) => !props.modelValue.includes(p.id))
  }, 250)
})

const full = computed(() => props.modelValue.length >= MAX_PICKED_PATIENTS)
function add(p: Row) {
  if (full.value || props.modelValue.includes(p.id)) return
  names.value = new Map(names.value).set(p.id, fullName(p))
  emit('update:modelValue', [...props.modelValue, p.id])
  query.value = ''
  results.value = []
}
function remove(id: string) {
  emit('update:modelValue', props.modelValue.filter((x) => x !== id))
}
</script>

<template>
  <div class="flex flex-col gap-2" data-test="segment-patients">
    <div class="relative">
      <input
        v-model="query"
        type="search"
        :class="FIELD"
        :disabled="full"
        :placeholder="t('Search a patient to add…', 'Busca un paciente para añadir…')"
        :aria-label="t('Add a patient', 'Añadir un paciente')"
        data-test="segment-patients-search"
      />
      <ul v-if="results.length" class="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-ctl border border-line bg-surface py-1 shadow-popover" role="listbox">
        <li v-for="p in results" :key="p.id">
          <button type="button" class="w-full px-3 py-2 text-left text-[13px] text-ink-700 hover:bg-surface-subtle touch:min-h-11" data-test="segment-patients-result" @click="add(p)">{{ fullName(p) }}</button>
        </li>
      </ul>
    </div>
    <ul v-if="modelValue.length" class="flex flex-wrap gap-1.5" data-test="segment-patients-chosen">
      <li v-for="id in modelValue.slice(0, SHOWN)" :key="id" class="inline-flex items-center gap-1 rounded-full border border-line bg-surface-subtle py-0.5 pl-2.5 pr-1 text-[12.5px] text-ink-700">
        <span>{{ names.get(id) ?? '…' }}</span>
        <button type="button" :class="REMOVE_BTN" :aria-label="t(`Remove ${names.get(id) ?? ''}`, `Quitar a ${names.get(id) ?? ''}`)" @click="remove(id)"><UiCloseIcon /></button>
      </li>
      <li v-if="modelValue.length > SHOWN" class="self-center text-[12.5px] text-ink-muted">{{ t(`and ${modelValue.length - SHOWN} more`, `y ${modelValue.length - SHOWN} más`) }}</li>
    </ul>
    <span :class="HINT">
      {{
        full
          ? t(`That is the most a send can name one by one (${MAX_PICKED_PATIENTS}). For more, save them as a list or segment in Patients.`, `Es el máximo que un envío puede nombrar uno a uno (${MAX_PICKED_PATIENTS}). Para más, guárdalos como lista o segmento en Pacientes.`)
          : t('Exactly these people, whatever changes later. Whoever cannot receive it (no consent, archived, a minor or not to be contacted) is left out when it goes.', 'Exactamente estas personas, cambie lo que cambie después. Quien no pueda recibirlo (sin consentimiento, archivado, menor o «no contactar») queda fuera al enviarse.')
      }}
    </span>
  </div>
</template>
