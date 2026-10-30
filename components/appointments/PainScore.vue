<script setup lang="ts">
// Pain 0-10 for one visit (visit_pain_scores), tapped by the practitioner
// above today's note on My Day and in the staff app's visit screen. Saved as
// it is tapped; tapping the chosen number again clears it. When the patient
// gave a score at check-in it is shown beside the row, and the practitioner's
// replaces it wherever a visit's pain is read (coalesce(practitioner_score,
// patient_score)) -- the patient's is kept, not overwritten.
const props = defineProps<{ appointmentId: string; accountId: string; teamMemberId: string | null; editable: boolean }>()

const t = useT()
const supabase = useSupabaseClient()
const score = ref<number | null>(null)
const patientScore = ref<number | null>(null)
const loading = ref(true)
const saveError = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('visit_pain_scores').select('practitioner_score, patient_score').eq('appointment_id', props.appointmentId).maybeSingle()
  const row = data as { practitioner_score: number | null; patient_score: number | null } | null
  score.value = row?.practitioner_score ?? null
  patientScore.value = row?.patient_score ?? null
  loading.value = false
}
watch(() => props.appointmentId, load, { immediate: true })

// One save at a time, the last tap winning.
let chain: Promise<void> = Promise.resolve()
function tap(n: number) {
  if (!props.editable) return
  const next = score.value === n ? null : n
  score.value = next
  chain = chain.then(async () => {
    saveError.value = ''
    const now = new Date().toISOString()
    const { error } = await supabase.from('visit_pain_scores').upsert(
      {
        account_id: props.accountId,
        appointment_id: props.appointmentId,
        practitioner_score: next,
        practitioner_id: next === null ? null : props.teamMemberId,
        practitioner_scored_at: next === null ? null : now,
        updated_at: now,
      } as never,
      { onConflict: 'appointment_id' },
    )
    if (error) saveError.value = t("Couldn't save the pain score. Try again.", 'No se ha podido guardar el dolor. Inténtalo de nuevo.')
  })
}
</script>

<template>
  <div data-cy="pain-score">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Pain today', 'Dolor hoy') }}</span>
      <span class="text-[11.5px] text-ink-faint">{{ t('0 none · 10 worst', '0 nada · 10 el peor') }}</span>
      <span v-if="patientScore !== null" class="text-[12px] text-ink-muted" data-cy="pain-score-patient">
        {{ score === null ? t(`The patient gave ${patientScore} at check-in.`, `El paciente marcó ${patientScore} al llegar.`) : t(`Patient: ${patientScore}`, `Paciente: ${patientScore}`) }}
      </span>
    </div>
    <div class="mt-1.5 flex flex-wrap gap-1" role="radiogroup" :aria-label="t('Pain today, 0 to 10', 'Dolor hoy, de 0 a 10')">
      <button
        v-for="n in 11"
        :key="n - 1"
        type="button"
        role="radio"
        :aria-checked="score === n - 1"
        :disabled="loading || !editable"
        class="h-8 min-w-8 rounded-ctlSm px-1 text-[12.5px] font-semibold disabled:cursor-default"
        :class="score === n - 1 ? 'bg-brand text-brand-on' : 'border border-line-control bg-surface text-ink-700 hover:border-line-controlHover'"
        :data-cy="`pain-score-${n - 1}`"
        @click="tap(n - 1)"
      >
        {{ n - 1 }}
      </button>
    </div>
    <p v-if="saveError" role="alert" class="mt-1 text-[12px] text-danger-text">{{ saveError }}</p>
  </div>
</template>
