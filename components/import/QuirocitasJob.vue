<script setup lang="ts">
import type { ImportJobRow } from '~/composables/useQuirocitas'
import type { ImportJobProgress, ImportJobStepResult } from '~/utils/importJobReport'

// An import job running on the server, or the last one that ran: one bar
// across every step it does, where the current step stands, and what each
// finished step wrote. The tab can be closed at any point -- the job carries
// on, and whoever started it gets an email when it ends.
const props = defineProps<{ job: ImportJobRow }>()
const emit = defineEmits<{ cancel: [] }>()

const t = useT()
const nf = new Intl.NumberFormat('es-ES')
const stopping = ref(false)

const active = computed(() => importJobActive(props.job))
const progress = computed(() => (props.job.progress ?? {}) as ImportJobProgress)
const results = computed(() => (props.job.results ?? []) as unknown as ImportJobStepResult[])
const current = computed(() => props.job.steps[props.job.step_index])
const percent = computed(() => importJobPercent(props.job))

const now = computed(() => {
  const p = progress.value
  if (props.job.status === 'queued') return t('Starting…', 'Empezando…')
  if (current.value === 'read') {
    if (p.phase === 'patients' && p.total) return t(`Reading patients: ${nf.format(p.done ?? 0)} of ${nf.format(p.total)}`, `Leyendo pacientes: ${nf.format(p.done ?? 0)} de ${nf.format(p.total)}`) + (p.failed ? t(` · ${p.failed} could not be read`, ` · ${p.failed} sin leer`) : '')
    if (p.phase === 'ledger') return p.month ? t(`Reading the cash ledger: back to ${p.month}`, `Leyendo la caja: hasta ${p.month}`) : t('Reading the cash ledger…', 'Leyendo la caja…')
    return t('Reading the patient list…', 'Leyendo la lista de pacientes…')
  }
  const label = importJobStepLabel(current.value ?? '', t)
  return p.total ? `${label}: ${t(`${nf.format(p.done ?? 0)} of ${nf.format(p.total)}`, `${nf.format(p.done ?? 0)} de ${nf.format(p.total)}`)}` : t(`${label}: comparing with what is already here…`, `${label}: comparando con lo que ya hay…`)
})

const ended = computed(() => {
  const j = props.job
  const when = j.finished_at ? new Date(j.finished_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : ''
  if (j.status === 'done') return t(`Finished ${when}.`, `Terminado el ${when}.`)
  if (j.status === 'cancelled') return t(`Stopped ${when}. What was imported until then stays; starting again carries on from there.`, `Parado el ${when}. Lo importado hasta entonces se queda; al volver a empezar sigue desde ahí.`)
  return t(`Stopped with an error ${when}. What was imported until then stays; starting again carries on from there.`, `Se detuvo por un error el ${when}. Lo importado hasta entonces se queda; al volver a empezar sigue desde ahí.`)
})

async function cancel() {
  stopping.value = true
  emit('cancel')
}
watch(() => props.job.id, () => { stopping.value = false })
</script>

<template>
  <div class="space-y-3 rounded-lg border border-line bg-surface p-4" data-cy="qc-job" :data-status="job.status">
    <template v-if="active">
      <div class="h-2 overflow-hidden rounded-full bg-surface-subtle"><div class="h-full bg-brand transition-all" :style="{ width: `${percent}%` }" /></div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted2">
        <span data-cy="qc-job-now">{{ now }}</span>
        <span v-if="job.steps.length > 1" class="text-ink-faint">{{ t(`Step ${job.step_index + 1} of ${job.steps.length}`, `Paso ${job.step_index + 1} de ${job.steps.length}`) }}</span>
        <button type="button" class="font-medium text-ink-700 hover:underline disabled:opacity-50" :disabled="stopping || job.cancel_requested" data-cy="qc-job-stop" @click="cancel">
          {{ stopping || job.cancel_requested ? t('Stopping…', 'Parando…') : t('Stop', 'Parar') }}
        </button>
      </div>
      <p class="text-[12.5px] text-ink-muted2">{{ t('This runs on QuiroFlow\'s server: you can close this page or the browser. You will get an email when it finishes.', 'Esto se hace en el servidor de QuiroFlow: puedes cerrar esta página o el navegador. Te llegará un email cuando termine.') }}</p>
      <p v-if="progress.lastError" class="text-[12.5px] text-warning-text">{{ t(`Retrying after a problem: ${progress.lastError}`, `Reintentando tras un problema: ${progress.lastError}`) }}</p>
    </template>

    <p v-else class="text-sm font-medium" :class="job.status === 'done' ? 'text-success-text' : 'text-warning-text'" data-cy="qc-job-ended">{{ ended }}</p>
    <p v-if="job.status === 'failed' && job.error" class="text-[13px] text-danger-text">{{ job.error }}</p>

    <ul v-if="job.steps.length > 1 || results.length" class="space-y-1.5 text-[13px]">
      <li v-for="(step, i) in job.steps" :key="step" class="flex items-start gap-2">
        <span class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" :class="i < job.step_index ? 'bg-success-text' : i === job.step_index && active ? 'bg-brand' : 'bg-line-control'" />
        <div class="min-w-0">
          <span :class="i <= job.step_index ? 'text-ink-900' : 'text-ink-muted2'">{{ importJobStepLabel(step, t) }}</span>
          <template v-for="r in results.filter((x) => x.step === step)" :key="r.step">
            <span class="text-ink-muted2"> · {{ step === 'read' ? t(`${nf.format(r.written)} patients`, `${nf.format(r.written)} pacientes`) : t(`${nf.format(r.written)} saved`, `${nf.format(r.written)} guardados`) }}</span>
            <details v-if="r.errors.length || r.warnings.length" class="mt-1">
              <summary class="cursor-pointer text-[12.5px]" :class="r.errors.length ? 'text-warning-text' : 'text-ink-muted2'">
                {{ r.errors.length === 1 ? t('1 problem', '1 problema') : r.errors.length ? t(`${r.errors.length} problems`, `${r.errors.length} problemas`) : t('Notes', 'Notas') }}
              </summary>
              <ul class="mt-1 max-h-48 space-y-1 overflow-y-auto text-[12.5px]">
                <li v-for="(e, k) in r.errors.slice(0, 50)" :key="`e${k}`" class="text-danger-text">{{ e }}</li>
                <li v-for="(w, k) in r.warnings" :key="`w${k}`" class="text-ink-600">{{ w }}</li>
              </ul>
            </details>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>
