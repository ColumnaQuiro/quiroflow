<script setup lang="ts">
import type { PatientFilterForm } from '~/utils/patientFilters'

// The patient list's less frequent filters -- the ones a segment is usually
// made of (VIP and no booking, bono almost used up, new this month) -- in a
// panel under the toolbar, so the toolbar keeps the everyday five. Edits the
// page's form in place; the page reloads on any change.
const props = defineProps<{ form: PatientFilterForm }>()
const t = useT()
const store = useAccountStore()
const supabase = useSupabaseClient()

const knownTags = ref<{ tag: string; count: number }[]>([])
onMounted(async () => {
  const { data, error } = await supabase.rpc('patient_tags')
  if (error) throw error
  knownTags.value = (data ?? []).map((r) => ({ tag: r.tag, count: Number(r.patient_count) }))
})
// A tag in the filter that no patient carries any more still shows, so it can
// be taken off.
const tagOptions = computed(() => {
  const names = knownTags.value.map((k) => k.tag)
  return [...names, ...props.form.tags.filter((tag) => !names.includes(tag))]
})
function toggleTag(tag: string) {
  const tags = props.form.tags
  props.form.tags = tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]
}

const currentClinicName = computed(() => store.currentClinic?.name ?? t('this clinic', 'esta clínica'))

const fieldClass = 'h-8 rounded-ctl border border-line-control bg-surface px-2 text-[12.5px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const labelClass = 'text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint'
</script>

<template>
  <section
    :aria-label="t('More filters', 'Más filtros')"
    data-cy="more-filters"
    class="mt-2.5 grid gap-x-6 gap-y-4 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2 xl:grid-cols-3"
  >
    <fieldset class="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-3">
      <legend :class="labelClass" class="mb-1.5">{{ t('Tags (all of)', 'Etiquetas (todas)') }}</legend>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="tag in tagOptions"
          :key="tag"
          type="button"
          data-cy="tag-option"
          :aria-pressed="form.tags.includes(tag)"
          class="h-7 rounded-pill border px-2.5 text-[12px] font-medium outline-none focus-visible:shadow-focus"
          :class="form.tags.includes(tag) ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
          @click="toggleTag(tag)"
        >
          {{ tag }}
        </button>
        <span v-if="tagOptions.length === 0" class="text-[12.5px] text-ink-faint">{{ t('No patient has a tag yet.', 'Ningún paciente tiene etiquetas todavía.') }}</span>
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend :class="labelClass" class="mb-1.5">{{ t('Last visit', 'Última visita') }}</legend>
      <div class="flex items-center gap-1.5">
        <input v-model="form.lastVisitFrom" type="date" data-cy="last-visit-from" :aria-label="t('Last visit from', 'Última visita desde')" :class="fieldClass" />
        <span class="text-[12px] text-ink-faint">–</span>
        <input v-model="form.lastVisitTo" type="date" data-cy="last-visit-to" :aria-label="t('Last visit to', 'Última visita hasta')" :class="fieldClass" />
      </div>
    </fieldset>

    <fieldset class="flex flex-col gap-1.5">
      <legend :class="labelClass" class="mb-1.5">{{ t('Patient since', 'Paciente desde') }}</legend>
      <div class="flex items-center gap-1.5">
        <input v-model="form.createdFrom" type="date" data-cy="created-from" :aria-label="t('Created from', 'Alta desde')" :class="fieldClass" />
        <span class="text-[12px] text-ink-faint">–</span>
        <input v-model="form.createdTo" type="date" data-cy="created-to" :aria-label="t('Created to', 'Alta hasta')" :class="fieldClass" />
      </div>
    </fieldset>

    <div class="flex flex-col items-start gap-1.5">
      <span :class="labelClass">{{ t('Next appointment', 'Próxima cita') }}</span>
      <PatientsFilterSelect v-model="form.futureAppointment" :label="t('Next appointment', 'Próxima cita')" :options="[
        { value: '', label: t('Any', 'Cualquiera') },
        { value: 'yes', label: t('Has a future appointment', 'Con cita futura') },
        { value: 'no', label: t('No future appointment', 'Sin cita futura') },
      ]" />
    </div>

    <div class="flex flex-col items-start gap-1.5">
      <span :class="labelClass">{{ t('Bono', 'Bono') }}</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <PatientsFilterSelect v-model="form.bono" :label="t('Bono', 'Bono')" :options="[
          { value: '', label: t('Any', 'Cualquiera') },
          { value: 'active', label: t('Has a live bono', 'Con bono activo') },
          { value: 'none', label: t('No live bono', 'Sin bono activo') },
        ]" />
        <label v-if="form.bono === 'active'" class="flex items-center gap-1.5 text-[12.5px] text-ink-600">
          {{ t('sessions left ≤', 'sesiones restantes ≤') }}
          <input
            v-model="form.bonoSessionsMax"
            type="number"
            min="0"
            inputmode="numeric"
            data-cy="bono-sessions-max"
            :aria-label="t('At most this many sessions left', 'Como mucho estas sesiones restantes')"
            :class="fieldClass"
            class="w-16"
          />
        </label>
      </div>
    </div>

    <div class="flex flex-col items-start gap-1.5">
      <span :class="labelClass">{{ t('Patient app', 'App del paciente') }}</span>
      <PatientsFilterSelect v-model="form.app" :label="t('Patient app', 'App del paciente')" :options="[
        { value: '', label: t('Any', 'Cualquiera') },
        { value: 'yes', label: t('Uses the app', 'Usa la app') },
        { value: 'no', label: t('Does not use the app', 'No usa la app') },
      ]" />
    </div>

    <div v-if="store.clinics.length > 1" class="flex flex-col items-start gap-1.5">
      <span :class="labelClass">{{ t('Clinic', 'Clínica') }}</span>
      <PatientsFilterSelect v-model="form.clinic" :label="t('Clinic', 'Clínica')" :options="[
        { value: '', label: `${currentClinicName} ${t('(selected)', '(seleccionada)')}` },
        { value: 'all', label: t('All clinics', 'Todas las clínicas') },
        ...store.clinics.filter((c) => c.id !== store.currentClinicId).map((c) => ({ value: c.id, label: c.name })),
      ]" />
    </div>

    <label class="flex items-center gap-2 self-end text-[13px] text-ink-700">
      <input v-model="form.birthdayThisMonth" type="checkbox" data-cy="birthday-this-month" class="h-4 w-4 accent-brand" />
      {{ t('Birthday this month', 'Cumple este mes') }}
    </label>
  </section>
</template>
