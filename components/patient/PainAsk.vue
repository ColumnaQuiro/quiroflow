<script setup lang="ts">
// "¿Cuánto dolor tienes hoy?" -- asked once the patient has checked in, in
// the app and the portal (PatientCheckIn). One tap from 0 to 10, saved by
// set_my_pain_score on their own visit, and shown to the practitioner beside
// the note. Beside the question, what they gave last time and when they
// started (my_pain_context), so the number means something. Answered or
// dismissed, it goes away; it never blocks the check-in it follows.
const props = defineProps<{ appointmentId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const ctx = ref<{ today: number | null; previous: number | null; first: number | null } | null>(null)
const picked = ref<number | null>(null)
const saved = ref(false)
const dismissed = ref(false)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  const { data } = await supabase.rpc('my_pain_context', { p_appointment_id: props.appointmentId })
  ctx.value = (data as typeof ctx.value) ?? null
  if (ctx.value?.today != null) saved.value = true
})

async function save() {
  if (picked.value === null) return
  busy.value = true
  error.value = ''
  const { data, error: failed } = await supabase.rpc('set_my_pain_score', { p_appointment_id: props.appointmentId, p_score: picked.value })
  busy.value = false
  if (failed || !data) {
    error.value = t("Couldn't save it. You can tell your practitioner instead.", 'No se ha podido guardar. Puedes decírselo a tu profesional.')
    return
  }
  saved.value = true
}
</script>

<template>
  <div v-if="ctx && !saved && !dismissed" class="rounded-card border border-line bg-surface p-3.5" data-cy="pain-ask">
    <p class="text-[15px] font-semibold text-ink-900">{{ t('How much pain do you have today?', '¿Cuánto dolor tienes hoy?') }}</p>
    <p class="mt-0.5 text-[12.5px] text-ink-muted">{{ t('0 is no pain at all, 10 the worst you can imagine.', '0 es nada de dolor y 10 el peor que puedas imaginar.') }}</p>
    <div class="mt-3 grid grid-cols-6 gap-1.5" role="radiogroup" :aria-label="t('Pain from 0 to 10', 'Dolor de 0 a 10')">
      <button
        v-for="n in 11"
        :key="n - 1"
        type="button"
        role="radio"
        :aria-checked="picked === n - 1"
        class="h-11 rounded-ctl text-[15px] font-semibold"
        :class="picked === n - 1 ? 'bg-brand text-brand-on' : 'border border-line-control bg-surface text-ink-700'"
        :data-cy="`pain-ask-${n - 1}`"
        @click="picked = n - 1"
      >
        {{ n - 1 }}
      </button>
    </div>
    <p v-if="ctx.previous !== null" class="mt-2.5 text-[12.5px] text-ink-muted" data-cy="pain-ask-before">
      {{ ctx.first !== null && ctx.first !== ctx.previous ? t(`Last time you gave ${ctx.previous}. When you started, ${ctx.first}.`, `La última vez marcaste ${ctx.previous}. Al empezar, ${ctx.first}.`) : t(`Last time you gave ${ctx.previous}.`, `La última vez marcaste ${ctx.previous}.`) }}
    </p>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
    <div class="mt-3 flex gap-2">
      <button type="button" class="min-h-11 flex-1 rounded-ctl border border-line-control bg-surface text-[14px] font-medium text-ink-700" data-cy="pain-ask-skip" @click="dismissed = true">{{ t('Not now', 'Ahora no') }}</button>
      <button type="button" class="min-h-11 flex-[2] rounded-ctl bg-brand text-[15px] font-semibold text-brand-on disabled:opacity-60" :disabled="picked === null || busy" data-cy="pain-ask-save" @click="save">
        {{ busy ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
      </button>
    </div>
  </div>
  <p v-else-if="saved && picked !== null" class="text-[12.5px] text-ink-muted" role="status" data-cy="pain-ask-saved">{{ t('Thanks, your practitioner will see it.', 'Gracias, tu profesional lo verá.') }}</p>
</template>
