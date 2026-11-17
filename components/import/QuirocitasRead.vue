<script setup lang="ts">
// Reads the whole clinic out of Quirocitas, on the server, into a copy every
// import step works from (see composables/useQuirocitas.ts). Nothing is
// written to QuiroFlow here.
const t = useT()
const connection = useQuirocitasConnection()
const { copy } = useQuirocitasCopy()
const { job, start, cancel } = useQuirocitasJob()
const nf = new Intl.NumberFormat('es-ES')

const error = ref('')
const forgetting = ref(false)
const starting = ref(false)

onMounted(async () => {
  await Promise.all([loadQuirocitasConnection(), loadQuirocitasCopy({ counts: true })])
})

const running = computed(() => importJobActive(job.value))
// The last job is shown here only when it read: a lone import step's job
// belongs on that step's screen.
const readJob = computed(() => (job.value?.steps.includes('read') ? job.value : null))

async function read(fromScratch = false) {
  starting.value = true
  error.value = ''
  try {
    await start(['read'], { fromScratch })
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The read could not start.', es: 'No se pudo empezar la lectura.' })
  } finally {
    starting.value = false
  }
}

async function forget() {
  forgetting.value = false
  try {
    await forgetQuirocitasCopy()
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The copy could not be deleted.', es: 'No se pudo borrar la copia.' })
  }
}
</script>

<template>
  <div class="space-y-4" data-cy="qc-read">
    <ImportIntro
      :lead="t('Reads every patient, their history, bonos and invoices, then the cash ledger, from Quirocitas into a copy on QuiroFlow\'s server. The steps after it import from that copy. It takes about fifteen minutes for 2000 patients, and you can close this page while it runs.', 'Lee de Quirocitas cada paciente, su historial, bonos y facturas, y después la caja, a una copia en el servidor de QuiroFlow. Los pasos siguientes importan desde esa copia. Tarda unos quince minutos por cada 2000 pacientes, y puedes cerrar esta página mientras tanto.')"
      :notes="[
        { title: t('Nothing is written yet.', 'Aún no se escribe nada.'), body: t('Reading changes nothing in Quirocitas or in QuiroFlow.', 'Leer no cambia nada en Quirocitas ni en QuiroFlow.') },
        { title: t('Stop and carry on.', 'Para y sigue.'), body: t('Stopping keeps what has been read; reading again picks up where it stopped. Once a read has finished, reading again goes through every patient for what changed in Quirocitas since.', 'Al parar se guarda lo leído; al volver a leer sigue donde se quedó. Cuando una lectura ha terminado, volver a leer repasa cada paciente para traer lo que haya cambiado en Quirocitas.') },
      ]"
    />

    <p v-if="!quirocitasConnected(connection)" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the Quirocitas connection first.', 'Guarda antes la conexión con Quirocitas.') }}
    </p>

    <div v-else-if="!running" class="flex flex-wrap items-center gap-3">
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="starting" data-cy="qc-read-start" @click="read(false)">
        {{ copy ? (copy.state.finished ? t('Read again for changes', 'Volver a leer los cambios') : t('Carry on reading', 'Seguir leyendo')) : t('Read Quirocitas', 'Leer Quirocitas') }}
      </button>
      <button v-if="copy" type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="starting" @click="read(true)">
        {{ t('Read everything from scratch', 'Leer todo desde cero') }}
      </button>
      <button v-if="copy" type="button" class="text-sm font-medium text-danger-text hover:underline" @click="forgetting = true">
        {{ t('Delete the copy', 'Borrar la copia') }}
      </button>
    </div>
    <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>

    <ImportQuirocitasJob v-if="readJob" :job="readJob" @cancel="cancel" />
    <p v-else-if="running" class="text-[13px] text-ink-muted2">{{ t('An import is running for this clinic. Its progress is under "Import everything" or on the step it is running.', 'Hay una importación en marcha para esta clínica. Su progreso está en «Importar todo» o en el paso que se está haciendo.') }}</p>

    <div v-if="copy && !running" class="rounded-lg border border-line bg-surface p-4" data-cy="qc-read-summary">
      <p class="mb-3 text-[13px] text-ink-muted2">{{ t(`Read ${new Date(copy.readAt).toLocaleString('es-ES')}`, `Leído el ${new Date(copy.readAt).toLocaleString('es-ES')}`) }}</p>
      <p v-if="!copy.state.finished" class="mb-3 rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] font-medium text-warning-text" data-cy="qc-read-unfinished-summary">
        <template v-if="copy.state.total">{{ t(`This read has not finished: ${nf.format(copy.state.read)} of ${nf.format(copy.state.total)} patients, cash ledger not yet. Press "Carry on reading" before importing.`, `Esta lectura no ha terminado: ${nf.format(copy.state.read)} de ${nf.format(copy.state.total)} pacientes, y la caja sin leer. Pulsa «Seguir leyendo» antes de importar.`) }}</template>
        <template v-else>{{ t('This read has not finished: the cash ledger is not read yet and some patients may be missing. Press "Carry on reading" before importing.', 'Esta lectura no ha terminado: la caja está sin leer y puede que falten pacientes. Pulsa «Seguir leyendo» antes de importar.') }}</template>
      </p>
      <dl v-if="copy.counts" class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt class="text-ink-muted2">{{ t('Patients', 'Pacientes') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.patients) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Appointments', 'Citas') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.appointments) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Visit notes', 'Notas de visita') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.notes) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Visits with segments', 'Visitas con segmentos') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.segments) }}</dd></div>
        <div><dt class="text-ink-muted2">Bonos</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.bonos) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Invoices', 'Facturas') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.invoices) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Files', 'Archivos') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(copy.counts.files) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Cash ledger', 'Caja') }}</dt><dd class="font-medium text-ink-900">{{ copy.state.finished ? t(`${copy.months} months, since ${copy.firstMonth}`, `${copy.months} meses, desde ${copy.firstMonth}`) : t('Not read yet', 'Sin leer') }}</dd></div>
      </dl>
      <p v-if="copy.failed" class="mt-3 text-[13px] text-warning-text">{{ t(`${copy.failed} patients could not be read. Carry on reading to retry them.`, `${copy.failed} pacientes no se pudieron leer. Sigue leyendo para reintentarlo.`) }}</p>
      <p v-if="copy.state.finished && !copy.mismatched.length" class="mt-3 text-[13px] text-success-text" data-cy="qc-ledger-reconciled">
        {{ t(`Every month of the cash ledger adds up to the totals Quirocitas prints (${nf.format(copy.ledgerRows)} entries).`, `Cada mes de la caja suma lo que Quirocitas imprime (${nf.format(copy.ledgerRows)} apuntes).`) }}
      </p>
      <p v-else-if="copy.mismatched.length" class="mt-3 text-[13px] text-danger-text">
        {{ t(`These months do not add up to Quirocitas' totals: ${copy.mismatched.join(', ')}.`, `Estos meses no suman lo que imprime Quirocitas: ${copy.mismatched.join(', ')}.`) }}
      </p>
    </div>

    <UiConfirmDialog
      v-if="forgetting"
      tone="danger"
      :title="t('Delete the copy read from Quirocitas?', '¿Borrar la copia leída de Quirocitas?')"
      :confirm-label="t('Delete', 'Borrar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="forget"
      @cancel="forgetting = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Only the copy read from Quirocitas is deleted. Nothing already imported changes, and Quirocitas is not touched.', 'Solo se borra la copia leída de Quirocitas. No cambia nada de lo ya importado ni se toca Quirocitas.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
