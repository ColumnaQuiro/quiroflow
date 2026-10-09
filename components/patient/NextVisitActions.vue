<script setup lang="ts">
import { devicePlatform, directionsUrl } from '../../utils/clinicLinks'

// Under the next visit, in the app and the portal: put it in the phone's
// calendar (an .ics via a short-lived link, see
// server/api/portal/appointments/calendar-link.post.ts) and get directions
// to its clinic in the device's own maps app.
const props = defineProps<{ appointmentId: string; clinicId: string | null | undefined }>()

const t = useT()
const authedFetch = useAuthedFetch()
const { clinicOf } = usePatientClinics()
const platform = import.meta.client ? devicePlatform(window as never) : 'web'
const directions = computed(() => {
  const clinic = clinicOf(props.clinicId)
  return clinic ? directionsUrl(clinic, platform) : null
})

const busy = ref(false)
const error = ref('')
async function addToCalendar() {
  busy.value = true
  error.value = ''
  try {
    await openWhenReady(async () => (await authedFetch<{ url: string }>('/api/portal/appointments/calendar-link', { method: 'POST', body: { appointmentId: props.appointmentId } })).url)
  } catch {
    error.value = t("Couldn't prepare it for your calendar. Try again.", 'No se ha podido preparar para tu calendario. Inténtalo de nuevo.')
  } finally {
    busy.value = false
  }
}
function openDirections() {
  if (directions.value) openWhenReady(async () => directions.value)
}
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="min-h-9 rounded-ctl border border-line-control bg-surface px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle" :disabled="busy" data-cy="patient-add-to-calendar" @click="addToCalendar">
        {{ busy ? t('Preparing…', 'Preparando…') : t('Add to calendar', 'Añadir al calendario') }}
      </button>
      <button v-if="directions" type="button" class="min-h-9 rounded-ctl border border-line-control bg-surface px-3 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle active:bg-surface-subtle" data-cy="patient-next-directions" @click="openDirections">
        {{ t('Directions', 'Cómo llegar') }}
      </button>
    </div>
    <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>
</template>
