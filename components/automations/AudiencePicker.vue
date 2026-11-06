<script setup lang="ts">
import { FIELD } from '~/utils/automationUi'
import type { AudienceRef } from '~/utils/automationAudience'

// One of the clinic's patient lists or segments (Patients › Lists, saved
// filters), with how many are in each: what a group send is aimed at, or
// what "enters a list or segment" watches. Read through the caller's own
// client, so it offers the shared ones and the person's own private ones --
// whatever the Patients page shows them.

const props = defineProps<{ modelValue: AudienceRef | null; testId?: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: AudienceRef | null] }>()
const t = useT()
const supabase = useSupabaseClient()

interface Option {
  kind: 'list' | 'segment'
  id: string
  name: string
  count: number | null
}
const options = ref<Option[]>([])
const loaded = ref(false)
onMounted(async () => {
  const [lists, segments, listCounts, segmentCounts] = await Promise.all([
    supabase.from('patient_lists').select('id, name').order('name'),
    supabase.from('patient_segments').select('id, name').order('name'),
    supabase.rpc('patient_list_counts'),
    supabase.rpc('patient_segment_counts'),
  ])
  const lc = new Map(((listCounts.data ?? []) as { list_id: string; patient_count: number }[]).map((r) => [r.list_id, Number(r.patient_count)]))
  const sc = new Map(((segmentCounts.data ?? []) as { segment_id: string; patient_count: number }[]).map((r) => [r.segment_id, Number(r.patient_count)]))
  options.value = [
    ...((lists.data ?? []) as { id: string; name: string }[]).map((l) => ({ kind: 'list' as const, id: l.id, name: l.name, count: lc.get(l.id) ?? null })),
    ...((segments.data ?? []) as { id: string; name: string }[]).map((s) => ({ kind: 'segment' as const, id: s.id, name: s.name, count: sc.get(s.id) ?? null })),
  ]
  loaded.value = true
})

const value = computed(() => (props.modelValue ? `${props.modelValue.kind}:${props.modelValue.id}` : ''))
// Chosen, but not among the lists this person can see: deleted, or someone
// else's private one. Shown, so the choice is not silently replaced.
const missing = computed(() => loaded.value && !!props.modelValue && !options.value.some((o) => o.kind === props.modelValue!.kind && o.id === props.modelValue!.id))
function onChange(raw: string) {
  if (!raw) return emit('update:modelValue', null)
  const [kind, id] = raw.split(':') as ['list' | 'segment', string]
  emit('update:modelValue', { kind, id })
}
const label = (o: Option) => (o.count === null ? o.name : `${o.name} · ${o.count}`)
</script>

<template>
  <div class="flex flex-col gap-1">
    <select :class="FIELD" :value="value" :data-test="testId" @change="onChange(($event.target as HTMLSelectElement).value)">
      <option value="">{{ placeholder ?? t('Choose a list or segment', 'Elige una lista o un segmento') }}</option>
      <option v-if="missing" :value="value">{{ t('A list that no longer exists', 'Una lista que ya no existe') }}</option>
      <optgroup v-if="options.some((o) => o.kind === 'list')" :label="t('Lists', 'Listas')">
        <option v-for="o in options.filter((x) => x.kind === 'list')" :key="o.id" :value="`list:${o.id}`">{{ label(o) }}</option>
      </optgroup>
      <optgroup v-if="options.some((o) => o.kind === 'segment')" :label="t('Segments', 'Segmentos')">
        <option v-for="o in options.filter((x) => x.kind === 'segment')" :key="o.id" :value="`segment:${o.id}`">{{ label(o) }}</option>
      </optgroup>
    </select>
    <p v-if="loaded && !options.length" class="text-[12px] text-ink-muted">
      {{ t('No lists or segments yet. Make one in Patients: save the filters as a segment, or add people to a list.', 'Aún no hay listas ni segmentos. Créalos en Pacientes: guarda los filtros como segmento, o añade personas a una lista.') }}
    </p>
    <p v-if="missing" class="text-[12px] text-danger-text" data-test="audience-missing">{{ t('This list or segment no longer exists. Choose another.', 'Esta lista o segmento ya no existe. Elige otro.') }}</p>
  </div>
</template>
