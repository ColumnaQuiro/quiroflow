<script setup lang="ts">
// "Import everything": reads Quirocitas and runs every import step after it,
// in the order they depend on each other, as one job on the server. The
// step-by-step screens stay for checking a preview before writing; this is
// for a clinic that wants it done. Pressed again later, it brings across what
// changed in Quirocitas since -- every step writes only what is missing.
const t = useT()
const store = useAccountStore()
const connection = useQuirocitasConnection()
const { copy } = useQuirocitasCopy()
const { job, start, cancel } = useQuirocitasJob()

const confirming = ref(false)
const quietUpcoming = ref(true)
const error = ref('')
const starting = ref(false)

onMounted(() => { loadQuirocitasConnection() })

const running = computed(() => importJobActive(job.value))
const imported = computed(() => Boolean(copy.value?.state.finished))
const clinicName = computed(() => store.currentClinic?.name ?? '')

async function go() {
  confirming.value = false
  starting.value = true
  error.value = ''
  try {
    await start(['read', ...QUIROCITAS_STEPS], { quietUpcoming: quietUpcoming.value })
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The import could not start.', es: 'No se pudo empezar la importación.' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="space-y-4" data-cy="qc-full">
    <ImportIntro
      :lead="t('Reads Quirocitas and imports everything in one go: patients, appointments, clinical history, bonos, payments and files, in that order. It runs on QuiroFlow\'s server, so you can close this page; you get an email when it is done.', 'Lee Quirocitas e importa todo de una vez: pacientes, citas, historial clínico, bonos, pagos y archivos, en ese orden. Se hace en el servidor de QuiroFlow, así que puedes cerrar esta página; te llega un email cuando termine.')"
      :notes="[
        { title: t('Safe to run again.', 'Se puede repetir.'), body: t('Running it again later brings across only what changed in Quirocitas since: nothing is duplicated, and what QuiroFlow has already changed (a visit moved or checked in here) is kept.', 'Al repetirla más adelante, solo trae lo que haya cambiado en Quirocitas desde entonces: no se duplica nada, y se respeta lo que ya se haya cambiado en QuiroFlow (una visita movida o registrada aquí).') },
        { title: t('Want to check first?', '¿Prefieres revisar antes?'), body: t('Every step can still be run on its own from the list, with a preview of what it will write.', 'Cada paso se puede seguir haciendo por separado desde la lista, con una vista previa de lo que va a escribir.') },
      ]"
    />

    <p v-if="!quirocitasConnected(connection)" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the Quirocitas connection first.', 'Guarda antes la conexión con Quirocitas.') }}
    </p>
    <p v-else-if="!store.currentClinicId" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Choose the clinic to import into, in the clinic switcher in the sidebar.', 'Elige la clínica a la que importar, en el selector de clínica de la barra lateral.') }}
    </p>

    <template v-else-if="!running">
      <label class="flex items-start gap-2 text-[13px] text-ink-700">
        <input v-model="quietUpcoming" type="checkbox" class="mt-0.5" data-cy="qc-full-quiet-upcoming" />
        <span>{{ t('Quirocitas is still sending reminders: do not send them from QuiroFlow for the upcoming visits imported now.', 'Quirocitas aún envía los recordatorios: no enviarlos desde QuiroFlow para las próximas visitas que se importan ahora.') }}</span>
      </label>
      <div>
        <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="starting" data-cy="qc-full-start" @click="confirming = true">
          {{ imported ? t('Import everything again (sync)', 'Volver a importar todo (sincronizar)') : t('Import everything', 'Importar todo') }}
        </button>
      </div>
      <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    </template>

    <ImportQuirocitasJob v-if="job" :job="job" @cancel="cancel" />

    <UiConfirmDialog
      v-if="confirming"
      :title="t('Import everything from Quirocitas?', '¿Importar todo de Quirocitas?')"
      :confirm-label="t('Import everything', 'Importar todo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="go"
      @cancel="confirming = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        {{ clinicName
          ? t(`Reads every patient from Quirocitas and imports them, with their visits, history, bonos, payments and files, into ${clinicName}. It usually takes between half an hour and an hour; you can close this page.`, `Lee cada paciente de Quirocitas y lo importa, con sus visitas, historial, bonos, pagos y archivos, en ${clinicName}. Suele tardar entre media hora y una hora; puedes cerrar esta página.`)
          : t('Reads every patient from Quirocitas and imports them, with their visits, history, bonos, payments and files. It usually takes between half an hour and an hour; you can close this page.', 'Lee cada paciente de Quirocitas y lo importa, con sus visitas, historial, bonos, pagos y archivos. Suele tardar entre media hora y una hora; puedes cerrar esta página.') }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
