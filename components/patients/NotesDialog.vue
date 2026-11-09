<script setup lang="ts">
// The visit-note dialog the patient record opens, from Clinical and from
// Appointments alike. It was two copies of the same markup until it gained
// "History": the patient's completed forms in a column beside the note, so
// an assessment can be written while reading what the patient filled in.
// Practitioners used to open that form in a second browser tab for exactly
// this, and the dialog covered the whole record, forms included.
const props = defineProps<{ appointmentId: string; patientId: string }>()
const emit = defineEmits<{ close: [] }>()

const t = useT()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))

// Remembered per browser: whoever opens it once for an assessment wants it
// there the next time, and whoever does not never sees it. A blocked
// storage only means it starts closed.
const HISTORY_KEY = 'notes-dialog-history-open'
function readHistoryOpen() {
  try {
    return localStorage.getItem(HISTORY_KEY) === '1'
  } catch {
    return false
  }
}
const historyOpen = ref(readHistoryOpen())
function toggleHistory() {
  historyOpen.value = !historyOpen.value
  try {
    localStorage.setItem(HISTORY_KEY, historyOpen.value ? '1' : '0')
  } catch {
    // Not remembered; it still toggles.
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      class="flex max-h-[90vh] w-full flex-col rounded-card bg-surface p-6 shadow-drawer"
      :class="historyOpen ? 'max-w-5xl' : 'max-w-md'"
      data-cy="notes-dialog"
    >
      <div class="flex shrink-0 items-center justify-between gap-3">
        <h2 :id="titleId" class="text-[15px] font-semibold text-ink-900">{{ t('Visit notes', 'Notas de la visita') }}</h2>
        <div class="flex items-center gap-2">
          <UiBtn size="sm" :variant="historyOpen ? 'primary' : 'secondary'" :aria-pressed="historyOpen" data-cy="notes-dialog-history" @click="toggleHistory">
            {{ t('History', 'Historial') }}
          </UiBtn>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600 -m-2 p-2 touch:-m-3 touch:p-3" @click="emit('close')"><UiCloseIcon /></button>
        </div>
      </div>
      <!-- Each column scrolls on its own, so reading down a long form does
           not scroll the note being written out of view. Stacked on a phone,
           where there is no room beside it. -->
      <div class="mt-4 min-h-0 flex-1 overflow-y-auto md:grid md:grid-rows-1 md:gap-6 md:overflow-hidden" :class="historyOpen ? 'md:grid-cols-2' : ''">
        <section v-if="historyOpen" class="mb-6 border-b border-line-divider pb-6 md:mb-0 md:overflow-y-auto md:border-b-0 md:border-r md:pb-0 md:pr-6" :aria-label="t('Completed forms', 'Formularios completados')">
          <PatientsDocHistory :patient-id="props.patientId" />
        </section>
        <div class="md:overflow-y-auto">
          <AppointmentsNotesPanel :appointment-id="props.appointmentId" />
        </div>
      </div>
    </div>
  </div>
</template>
