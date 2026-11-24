<script setup lang="ts">
// Settings > Import > PracticeHub > Exercises: the clinic's exercise library
// and every patient's exercises, brought in on the server
// (utils/practicehubImport/exercises.ts) -- the same step Sync everything
// runs, here on its own. It reads PracticeHub first, because the step plans
// from that copy and a copy read before this step existed has no exercises.
const t = useT()
const connection = usePracticeHubConnection()
const { job, start, cancel } = useImportJob('practicehub')

const error = ref('')
const starting = ref(false)

onMounted(() => { loadSavedPracticeHubConnection() })

const running = computed(() => importJobActive(job.value))

async function go(dryRun: boolean) {
  starting.value = true
  error.value = ''
  try {
    await start(['read', 'exercises'], { dryRun })
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The import could not start.', es: 'No se pudo empezar la importación.' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="space-y-4" data-cy="ph-exercises">
    <ImportIntro
      :lead="t('Brings PracticeHub\'s exercise library into Exercises, and gives each patient the exercises they had there, with any notes written for them. Their videos come as links: YouTube and Vimeo play inside the patient app.', 'Trae la biblioteca de ejercicios de PracticeHub a Ejercicios, y asigna a cada paciente los que tenía allí, con las notas que se le escribieron. Los vídeos llegan como enlace: los de YouTube y Vimeo se ven dentro de la app del paciente.')"
      :notes="[
        { title: t('Patients first.', 'Primero los pacientes.'), body: t('A patient\'s exercises are only given once that patient is here: run Patients before this.', 'Los ejercicios de un paciente solo se asignan cuando ese paciente ya está aquí: importa los pacientes antes.') },
        { title: t('Safe to run again.', 'Se puede repetir.'), body: t('It brings only what is new. An exercise of the same name already in your library is used, not doubled, and nothing you have changed here is overwritten.', 'Solo trae lo nuevo. Si en tu biblioteca ya hay un ejercicio con el mismo nombre, se usa ese y no se duplica, y no se sobrescribe nada que hayas cambiado aquí.') },
        { title: t('No notification.', 'Sin avisos.'), body: t('Patients are not sent anything when their exercises arrive.', 'A los pacientes no se les envía nada cuando llegan sus ejercicios.') },
      ]"
    />

    <p v-if="!connection" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the PracticeHub connection first, in Connection.', 'Guarda antes la conexión con PracticeHub, en Conexión.') }}
    </p>

    <template v-else-if="!running">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-md border border-line-control bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="starting" data-cy="ph-exercises-preview" @click="go(true)">
          {{ t('Preview (writes nothing)', 'Vista previa (no escribe nada)') }}
        </button>
        <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="starting" data-cy="ph-exercises-start" @click="go(false)">
          {{ t('Import exercises', 'Importar ejercicios') }}
        </button>
      </div>
      <p class="text-[12.5px] text-ink-muted">
        {{ t('It reads PracticeHub again first, which takes a few minutes on a large clinic. You can close this page.', 'Primero vuelve a leer PracticeHub, que en una clínica grande tarda unos minutos. Puedes cerrar esta página.') }}
      </p>
      <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    </template>

    <ImportQuirocitasJob v-if="job" :job="job" @cancel="cancel" />
  </div>
</template>
