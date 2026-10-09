<script setup lang="ts">
// "Recordatorio diario" on the patient's Ejercicios screen: a push at the
// hour they pick, in their clinic's time zone, only on days something is
// still undone (server/utils/exerciseReminders.ts). App only -- the portal
// cannot receive a push. Stored on every patient record of theirs through
// set_my_exercise_reminder; patients have no write on patients themselves.
const props = defineProps<{ patientId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const HOURS = [9, 13, 18, 20, 21]
const hour = ref<number | null>(null)
const loaded = ref(false)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const { data } = await supabase.from('patients').select('exercise_reminder_hour').eq('id', props.patientId).maybeSingle()
  hour.value = (data as { exercise_reminder_hour: number | null } | null)?.exercise_reminder_hour ?? null
  loaded.value = true
})

async function choose(next: number | null) {
  if (saving.value || next === hour.value) return
  const before = hour.value
  hour.value = next
  saving.value = true
  error.value = ''
  const { data, error: e } = await supabase.rpc('set_my_exercise_reminder' as never, { p_hour: next } as never)
  saving.value = false
  if (e || data !== true) {
    hour.value = before
    error.value = t("Couldn't save it. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
  }
}
</script>

<template>
  <div v-if="loaded" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="exercise-reminder">
    <p class="text-[14px] font-medium text-ink-900">{{ t('Daily reminder', 'Recordatorio diario') }}</p>
    <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ t("A notification if you haven't ticked them off yet.", 'Un aviso si aún no los has marcado.') }}</p>
    <div class="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('Daily reminder', 'Recordatorio diario')">
      <button
        v-for="h in [null, ...HOURS]"
        :key="String(h)"
        type="button"
        role="radio"
        :aria-checked="hour === h"
        class="min-h-9 rounded-ctl border px-3 text-[13px] font-medium"
        :class="hour === h ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'"
        :disabled="saving"
        :data-cy="`exercise-reminder-${h ?? 'off'}`"
        @click="choose(h)"
      >
        {{ h === null ? t('Off', 'No') : `${h}:00` }}
      </button>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
