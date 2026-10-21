<script setup lang="ts">
import { answerLine, formAnswers, type FormAnswer } from '~/utils/formAnswers'

// The patient's completed forms, beside today's note on My Day, so the
// practitioner reads the intake answers there and brings what matters into
// Subjective instead of retyping it. Asked for by a practitioner who copied
// the first-visit form into their notes by hand.
//
// The most recent completed forms first, three at most; each folds open.
// Read through the practitioner's own session, so a role that may not see
// the patient's documents simply sees nothing here.
const props = defineProps<{ patientId: string; editable: boolean }>()
const emit = defineEmits<{ bring: [section: 'Subjective', text: string] }>()

const supabase = useSupabaseClient()
const t = useT()

interface DocAnswers {
  id: string
  title: string
  completedAt: string
  answers: FormAnswer[]
}
const docs = ref<DocAnswers[]>([])
const loading = ref(true)
const open = ref<string | null>(null)

watch(
  () => props.patientId,
  async (patientId) => {
    loading.value = true
    const { data } = await supabase
      .from('patient_docs')
      .select('id, title, completed_at, fields')
      .eq('patient_id', patientId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(3)
    if (patientId !== props.patientId) return
    docs.value = (data ?? [])
      .map((d) => ({ id: d.id, title: d.title, completedAt: d.completed_at!, answers: formAnswers(d.fields, t) }))
      .filter((d) => d.answers.length > 0)
    open.value = docs.value[0]?.id ?? null
    loading.value = false
  },
  { immediate: true },
)

function day(iso: string) {
  return new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
}
function bringAll(d: DocAnswers) {
  emit('bring', 'Subjective', d.answers.map(answerLine).join('\n'))
}
</script>

<template>
  <section v-if="loading || docs.length" class="rounded-card border border-line bg-surface-subtle2 p-4 shadow-card" data-cy="form-answers">
    <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Forms', 'Formularios') }}</h2>
    <div v-if="loading" class="mt-2 space-y-2"><UiSkeleton class="h-3.5 w-40 rounded-ctlSm" /><UiSkeleton class="h-3 w-full rounded-ctlSm" /></div>
    <div v-for="d in docs" v-else :key="d.id" class="mt-3 rounded-ctl border border-line bg-surface" data-cy="form-answers-doc">
      <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" :aria-expanded="open === d.id" @click="open = open === d.id ? null : d.id">
        <span class="min-w-0">
          <span class="block truncate text-[13px] font-semibold text-ink-900">{{ d.title }}</span>
          <span class="text-[11.5px] text-ink-muted">{{ t('Completed', 'Completado') }} {{ day(d.completedAt) }}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted transition-transform" :class="open === d.id ? 'rotate-180' : ''" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div v-if="open === d.id" class="border-t border-line-divider px-3 py-2">
        <div class="mb-1 flex justify-end">
          <button v-if="editable" type="button" class="text-[12px] font-semibold text-brand-text" data-cy="form-answers-bring-all" @click="bringAll(d)">{{ t('Bring all to Subjective', 'Traer todo a Subjetivo') }}</button>
        </div>
        <div v-for="a in d.answers" :key="a.label" class="flex items-start justify-between gap-2 py-1" data-cy="form-answer">
          <p class="min-w-0 text-[12.5px] leading-snug">
            <span class="text-ink-muted">{{ a.label }}</span>
            <span class="block whitespace-pre-line text-ink-900">{{ a.text }}</span>
          </p>
          <button v-if="editable" type="button" class="shrink-0 text-[12px] font-semibold text-brand-text" data-cy="form-answer-bring" @click="emit('bring', 'Subjective', answerLine(a))">{{ t('Bring', 'Traer') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
