<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const t = useT()
const { can } = usePermission()

// The same patients.sticky_note the calendar's appointment hover card edits
// (components/calendar/AppointmentHoverCard.vue) -- surfaced here too so a
// note that only ever showed on hover is visible on the record itself, which
// is where PracticeHub shows it and where the imported ones land.
const stickyNote = ref('')
const loading = ref(true)
const editing = ref(false)
const saving = ref(false)
const saveError = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('patients').select('sticky_note').eq('id', props.patientId).maybeSingle()
  stickyNote.value = data?.sticky_note ?? ''
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

// patients_edit is what the update needs (RLS "staff update patients"), and
// without it RLS updates nothing rather than failing -- so the rows updated
// are read back. The note used to read as saved and be gone on reload.
async function save() {
  saving.value = true
  saveError.value = ''
  const { data, error } = await supabase.from('patients').update({ sticky_note: stickyNote.value.trim() || null }).eq('id', props.patientId).select('id')
  if (error || !data?.length) saveError.value = error?.message ?? t('The note was not saved: your role cannot edit this patient.', 'No se ha guardado la nota: tu rol no puede editar este paciente.')
  saving.value = false
}
</script>

<template>
  <div v-if="!loading" class="rounded-card border border-warning-border bg-warning-bg2 p-4 shadow-card" data-cy="sticky-note">
    <div class="flex items-center justify-between gap-2">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Patient note', 'Nota del paciente') }}</p>
      <button v-if="can('patients_edit')" type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" data-cy="sticky-note-edit" @click="editing = !editing">
        {{ editing ? t('Done', 'Listo') : t('Edit', 'Editar') }}
      </button>
    </div>

    <template v-if="!editing">
      <p v-if="stickyNote" class="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-snug text-ink-600">{{ stickyNote }}</p>
      <p v-else class="mt-2 text-[12.5px] text-ink-faint">{{ t('No note recorded.', 'No hay nota registrada.') }}</p>
    </template>

    <textarea
      v-else
      v-model="stickyNote"
      rows="3"
      :placeholder="t('Persistent note for this patient — also shows on the calendar when you hover an appointment.', 'Nota permanente para este paciente: también aparece en el calendario al pasar el ratón por una cita.')"
      class="mt-2.5 w-full rounded-ctl border border-warning-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-700 focus:border-warning-accent focus:outline-none"
      @blur="save"
    ></textarea>
    <p v-if="saveError" role="alert" class="mt-1.5 text-[12px] text-danger-text" data-cy="sticky-note-error">{{ saveError }}</p>
  </div>
</template>
