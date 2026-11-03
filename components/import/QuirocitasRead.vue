<script setup lang="ts">
import type { QuirocitasReadProgress } from '~/composables/useQuirocitas'

// Reads the whole clinic out of Quirocitas once, into this browser, for every
// import step to work from (see composables/useQuirocitas.ts). Nothing is
// written to QuiroFlow here.
const t = useT()
const store = useAccountStore()
const connection = useQuirocitasConnection()
const snapshot = useQuirocitasSnapshot()
const nf = new Intl.NumberFormat('es-ES')

const running = ref(false)
const stopping = ref(false)
const progress = ref<QuirocitasReadProgress | null>(null)
const error = ref('')
const forgetting = ref(false)

onMounted(async () => {
  await Promise.all([loadQuirocitasConnection(), store.accountId ? loadQuirocitasSnapshot(store.accountId) : null])
})

const summary = computed(() => {
  const s = snapshot.value
  if (!s) return null
  const records = Object.values(s.patients)
  return {
    patients: records.length,
    failed: Object.keys(s.failed).length,
    appointments: records.reduce((a, r) => a + r.ficha.appointments.length, 0),
    notes: records.reduce((a, r) => a + r.history.visits.filter((v) => v.notes.trim()).length, 0),
    segments: records.reduce((a, r) => a + Object.keys(r.techniques).length, 0),
    bonos: new Set(records.flatMap((r) => r.ficha.bonos.map((b) => b.id))).size,
    invoices: new Set(records.flatMap((r) => r.invoices.map((i) => `${i.year}/${i.number}`))).size,
    files: records.reduce((a, r) => a + r.history.tests.length, 0),
    months: s.ledgerMonths.length,
    ledgerRows: s.ledger.length,
    firstMonth: s.ledgerMonths[s.ledgerMonths.length - 1]?.month,
    mismatched: quirocitasLedgerMismatches(s),
    complete: s.ledgerMonths.length > 0,
  }
})

async function read(again = false) {
  if (!store.accountId) return
  running.value = true
  stopping.value = false
  error.value = ''
  try {
    await readQuirocitas(store.accountId, { again, onProgress: (p) => { progress.value = p }, shouldStop: () => stopping.value })
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.message ?? t('The read stopped.', 'La lectura se detuvo.')
  } finally {
    running.value = false
  }
}

async function forget() {
  if (store.accountId) await forgetQuirocitasSnapshot(store.accountId)
  forgetting.value = false
  progress.value = null
}

const percent = computed(() => {
  const p = progress.value
  if (!p) return 0
  if (p.phase === 'patients' && p.total) return Math.round((p.done / p.total) * 90)
  if (p.phase === 'ledger') return 92
  return p.phase === 'done' ? 100 : 2
})
</script>

<template>
  <div class="space-y-4" data-cy="qc-read">
    <ImportIntro
      :lead="t('Reads every patient, their history, bonos and invoices, then the cash ledger, from Quirocitas into this browser. The steps after it import from that copy. It takes about ten minutes for 2,000 patients.', 'Lee de Quirocitas cada paciente, su historial, bonos y facturas, y después la caja, a una copia en este navegador. Los pasos siguientes importan desde esa copia. Tarda unos diez minutos por cada 2.000 pacientes.')"
      :notes="[
        { title: t('Nothing is written yet.', 'Aún no se escribe nada.'), body: t('Reading changes nothing in Quirocitas or in QuiroFlow.', 'Leer no cambia nada en Quirocitas ni en QuiroFlow.') },
        { title: t('Stop and carry on.', 'Para y sigue.'), body: t('Stopping keeps what has been read; reading again picks up where it stopped. The copy stays in this browser only.', 'Al parar se guarda lo leído; al volver a leer sigue donde se quedó. La copia solo queda en este navegador.') },
      ]"
    />

    <p v-if="!quirocitasConnected(connection)" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the Quirocitas connection first.', 'Guarda antes la conexión con Quirocitas.') }}
    </p>

    <div v-else class="flex flex-wrap items-center gap-3">
      <button v-if="!running" type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" data-cy="qc-read-start" @click="read(false)">
        {{ snapshot ? (summary?.complete ? t('Read again for changes', 'Volver a leer los cambios') : t('Carry on reading', 'Seguir leyendo')) : t('Read Quirocitas', 'Leer Quirocitas') }}
      </button>
      <button v-else type="button" class="rounded-md border border-line-control px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="stopping" @click="stopping = true">
        {{ stopping ? t('Stopping…', 'Parando…') : t('Stop', 'Parar') }}
      </button>
      <button v-if="snapshot && !running" type="button" class="text-sm font-medium text-ink-600 hover:underline" @click="read(true)">
        {{ t('Read everything from scratch', 'Leer todo desde cero') }}
      </button>
      <button v-if="snapshot && !running" type="button" class="text-sm font-medium text-danger-text hover:underline" @click="forgetting = true">
        {{ t('Delete the copy', 'Borrar la copia') }}
      </button>
    </div>

    <div v-if="running && progress" class="space-y-1.5" data-cy="qc-read-progress">
      <div class="h-2 overflow-hidden rounded-full bg-surface-subtle"><div class="h-full bg-brand transition-all" :style="{ width: `${percent}%` }" /></div>
      <p class="text-[13px] text-ink-muted2">
        <template v-if="progress.phase === 'list'">{{ t('Reading the patient list…', 'Leyendo la lista de pacientes…') }}</template>
        <template v-else-if="progress.phase === 'patients'">{{ t(`Patients: ${nf.format(progress.done)} of ${nf.format(progress.total)}`, `Pacientes: ${nf.format(progress.done)} de ${nf.format(progress.total)}`) }}<template v-if="progress.failed"> · {{ t(`${progress.failed} could not be read`, `${progress.failed} sin leer`) }}</template></template>
        <template v-else-if="progress.phase === 'ledger'">{{ t(`Cash ledger: back to ${progress.month}`, `Caja: hasta ${progress.month}`) }}</template>
      </p>
    </div>
    <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>

    <div v-if="summary && !running" class="rounded-lg border border-line bg-surface p-4" data-cy="qc-read-summary">
      <p class="mb-3 text-[13px] text-ink-muted2">{{ t(`Read ${new Date(snapshot!.readAt).toLocaleString('es-ES')}`, `Leído el ${new Date(snapshot!.readAt).toLocaleString('es-ES')}`) }}</p>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt class="text-ink-muted2">{{ t('Patients', 'Pacientes') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.patients) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Appointments', 'Citas') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.appointments) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Visit notes', 'Notas de visita') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.notes) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Visits with segments', 'Visitas con segmentos') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.segments) }}</dd></div>
        <div><dt class="text-ink-muted2">Bonos</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.bonos) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Invoices', 'Facturas') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.invoices) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Files', 'Archivos') }}</dt><dd class="font-medium text-ink-900">{{ nf.format(summary.files) }}</dd></div>
        <div><dt class="text-ink-muted2">{{ t('Cash ledger', 'Caja') }}</dt><dd class="font-medium text-ink-900">{{ summary.complete ? t(`${summary.months} months, since ${summary.firstMonth}`, `${summary.months} meses, desde ${summary.firstMonth}`) : t('Not read yet', 'Sin leer') }}</dd></div>
      </dl>
      <p v-if="summary.failed" class="mt-3 text-[13px] text-warning-text">{{ t(`${summary.failed} patients could not be read. Carry on reading to retry them.`, `${summary.failed} pacientes no se pudieron leer. Sigue leyendo para reintentarlo.`) }}</p>
      <p v-if="summary.complete && !summary.mismatched.length" class="mt-3 text-[13px] text-success-text" data-cy="qc-ledger-reconciled">
        {{ t(`Every month of the cash ledger adds up to the totals Quirocitas prints (${nf.format(summary.ledgerRows)} entries).`, `Cada mes de la caja suma lo que Quirocitas imprime (${nf.format(summary.ledgerRows)} apuntes).`) }}
      </p>
      <p v-else-if="summary.mismatched.length" class="mt-3 text-[13px] text-danger-text">
        {{ t(`These months do not add up to Quirocitas' totals: ${summary.mismatched.map((m) => m.month).join(', ')}.`, `Estos meses no suman lo que imprime Quirocitas: ${summary.mismatched.map((m) => m.month).join(', ')}.`) }}
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
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Only the copy in this browser is deleted. Nothing already imported changes, and Quirocitas is not touched.', 'Solo se borra la copia de este navegador. No cambia nada de lo ya importado ni se toca Quirocitas.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
