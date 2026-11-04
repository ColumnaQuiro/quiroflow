<script setup lang="ts">
import type { DocField } from '~/utils/docFields'

// The patient's completed forms -- the intake history, above all -- for
// reading beside the visit note while the patient talks. An assessment is
// written from that history, and with the note in a dialog over the whole
// record there was no way to have both on screen.
//
// Only completed ones: a form still awaiting the patient has nothing to read.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const t = useT()
const { formatLongDate } = useDates()
const logAccess = useAccessLog()

interface DocRow {
  id: string
  title: string
  fields: DocField[]
  completed_at: string
}
const docs = ref<DocRow[]>([])
const loading = ref(true)
const selectedId = ref<string | null>(null)
const selected = computed(() => docs.value.find((d) => d.id === selectedId.value) ?? null)

onMounted(async () => {
  const { data } = await supabase
    .from('patient_docs')
    .select('id, title, fields, completed_at')
    .eq('patient_id', props.patientId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
  docs.value = (data as unknown as DocRow[]) ?? []
  selectedId.value = docs.value[0]?.id ?? null
  loading.value = false
})

watch(selected, (doc) => {
  if (doc) logAccess('file_viewed', props.patientId, { doc: doc.title })
})
</script>

<template>
  <div data-cy="doc-history">
    <div v-if="loading" class="space-y-2">
      <UiSkeleton class="h-4 w-1/2 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-full rounded-ctlSm" />
      <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
    </div>
    <p v-else-if="docs.length === 0" class="text-[13px] text-ink-faint">
      {{ t('This patient has not completed any forms yet.', 'Este paciente aún no ha completado ningún formulario.') }}
    </p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="doc in docs"
          :key="doc.id"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[12px] font-medium outline-none focus-visible:shadow-focus touch:min-h-11"
          :class="doc.id === selectedId ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-600 hover:border-brand'"
          :aria-pressed="doc.id === selectedId"
          @click="selectedId = doc.id"
        >
          {{ doc.title }}
        </button>
      </div>
      <div v-if="selected" class="mt-3">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-[11.5px] text-ink-muted2">{{ t('Completed', 'Completado') }} {{ formatLongDate(selected.completed_at) }}</p>
          <a
            :href="`/patients/docs/${selected.id}`"
            target="_blank"
            class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover"
            :title="t('Open the answers in a new tab', 'Abrir las respuestas en una pestaña nueva')"
          >
            {{ t('New tab', 'Pestaña nueva') }} ↗
          </a>
        </div>
        <PatientsDocAnswers :fields="Array.isArray(selected.fields) ? selected.fields : []" />
      </div>
    </template>
  </div>
</template>
