<script setup lang="ts">
// Brings each imported invoice's original across from PracticeHub: the PDF
// the clinic handed the patient, filed with the patient beside the invoice
// the Ledger step imported (server/utils/practicehubInvoicePdfs.ts).
//
// The Ledger step copies the figures, and QuiroFlow can print a receipt from
// them, but that is not the document that was issued, and a copy of each one
// has to be kept for years after the clinic has left PracticeHub. Its API has
// no PDF, so this uses the same website sign-in as Signed forms; it runs on
// the server, and the page only starts it and shows where it is.
const t = useT()

const { status, busy, error, act } = usePracticeHubWeb((s) => s.invoiceOriginals.job.status === 'running' || s.job.status === 'running')

const job = computed(() => status.value?.invoiceOriginals.job)
const running = computed(() => job.value?.status === 'running')
const anyRunning = computed(() => running.value || status.value?.job.status === 'running')
const pct = computed(() => (!job.value || job.value.total === 0 ? 0 : Math.min(100, Math.round((job.value.cursor / job.value.total) * 100))))
const missing = computed(() => Math.max(0, (status.value?.invoiceOriginals.invoices ?? 0) - (status.value?.invoiceOriginals.originals ?? 0)))

const introLead = computed(() =>
  t(
    'Brings the original of every invoice imported from PracticeHub across, as the PDF PracticeHub printed, and files it with the patient. Run Ledger first: an original is filed with the invoice it belongs to.',
    'Trae de PracticeHub el original de cada factura importada, como el PDF que imprimía PracticeHub, y lo guarda en la ficha del paciente. Ejecuta antes Libro mayor: cada original se guarda con la factura a la que pertenece.',
  ),
)
const introNotes = computed(() => [
  {
    title: t('Why bring them.', 'Por qué traerlas.'),
    body: t(
      'QuiroFlow can print an imported invoice from its figures, but that is not the document the patient was given. A copy of every invoice issued has to be kept for years, and once you leave PracticeHub its originals are gone.',
      'QuiroFlow puede imprimir una factura importada a partir de sus datos, pero no es el documento que se entregó al paciente. Hay que conservar copia de cada factura emitida durante años, y cuando dejes PracticeHub sus originales desaparecen.',
    ),
  },
  {
    title: t('Checked before it is filed.', 'Se comprueba antes de guardarla.'),
    body: t(
      'Each PDF is filed only if PracticeHub’s invoice and the one here agree on the number, the day, the amount and the patient. One that does not is counted below and left alone.',
      'Cada PDF solo se guarda si la factura de PracticeHub y la de aquí coinciden en número, día, importe y paciente. La que no coincide se cuenta abajo y no se toca.',
    ),
  },
  {
    title: t('Same sign-in as Signed forms.', 'El mismo acceso que Formularios firmados.'),
    body: t(
      'It is saved once for both. You can close this page: it runs on the server and is safe to run again, an original already here is never downloaded twice. A clinic with many thousands of invoices takes a while: start it outside opening hours.',
      'Se guarda una vez para los dos. Puedes cerrar esta página: funciona en el servidor y se puede repetir, un original que ya está aquí nunca se descarga dos veces. Una clínica con muchos miles de facturas tarda un rato: lánzalo fuera del horario de la clínica.',
    ),
  },
])
</script>

<template>
  <div data-cy="ph-invoice-pdfs">
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="!status" class="mt-4 rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-muted2">
      {{ error || t('Loading…', 'Cargando…') }}
    </div>

    <div v-else-if="!status.hasAddress" class="mt-4 rounded-card border border-line bg-surface p-4 text-[13px] text-ink-700">
      {{ t('Save your PracticeHub address under Connection first.', 'Guarda antes la dirección de tu PracticeHub en Conexión.') }}
    </div>

    <template v-else-if="job">
      <ImportPracticeHubWebSignIn :status="status" :busy="busy" :locked="anyRunning" :act="act">
        <div class="rounded-card border border-line bg-surface p-4">
          <dl class="grid grid-cols-3 gap-3 text-[12.5px]">
            <div>
              <dt class="text-ink-faint">{{ t('Invoices imported', 'Facturas importadas') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900" data-cy="ph-invoices-total">{{ status.invoiceOriginals.invoices }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('With their original', 'Con su original') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900" data-cy="ph-invoices-originals">{{ status.invoiceOriginals.originals }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('Still missing', 'Faltan') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px]" :class="missing > 0 ? 'text-warning-text' : 'text-ink-700'">{{ missing }}</dd>
            </div>
          </dl>

          <template v-if="running">
            <div class="mt-4 flex items-baseline justify-between">
              <p class="text-[13px] font-medium text-ink-700">{{ t(`PracticeHub invoices checked: ${job.cursor} / ${job.total || '…'}`, `Facturas de PracticeHub revisadas: ${job.cursor} / ${job.total || '…'}`) }}</p>
              <p class="text-[12.5px] text-ink-muted2">{{ pct }}%</p>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${pct}%` }" />
            </div>
            <p class="mt-2 text-[12.5px] text-ink-muted2">{{ t('Running on the server. You can close this page.', 'En marcha en el servidor. Puedes cerrar esta página.') }}</p>
          </template>

          <p v-else-if="job.status === 'done'" class="mt-4 text-[12.5px] text-ink-700" data-cy="ph-invoices-done">
            {{ t(`Finished. Originals brought over in the last run: ${job.stored}.`, `Terminado. Originales traídos en la última ejecución: ${job.stored}.`) }}
          </p>
          <p v-else-if="job.status === 'failed'" class="mt-4 text-[12.5px] text-danger-text">
            {{ t(`It stopped because it could not get any further: ${job.error ?? ''}. Start it again to carry on from what is already here.`, `Se detuvo porque no podía avanzar: ${job.error ?? ''}. Inícialo de nuevo para seguir desde lo que ya está aquí.`) }}
          </p>
          <p v-else-if="job.status === 'stopped'" class="mt-4 text-[12.5px] text-ink-muted2">
            {{ t('Stopped. What was brought over is kept; start again to carry on.', 'Detenido. Lo que se trajo se conserva; inícialo de nuevo para seguir.') }}
          </p>
          <p v-else-if="job.status === 'needs_code'" class="mt-4 text-[12.5px] text-warning-text">
            {{ t('Waiting for the verification code above. It carries on by itself once it is entered.', 'Esperando el código de verificación de arriba. Sigue solo en cuanto se escriba.') }}
          </p>

          <template v-if="!running">
            <p v-if="job.mismatched > 0" class="mt-2 text-[12.5px] text-warning-text" data-cy="ph-invoices-mismatched">
              {{ t(`Invoices whose day, amount or patient here differ from PracticeHub’s, so their original was not filed: ${job.mismatched}.`, `Facturas cuyo día, importe o paciente aquí no coinciden con PracticeHub, así que su original no se guardó: ${job.mismatched}.`) }}
              <template v-if="job.mismatchExamples.length">{{ t(`For example: ${job.mismatchExamples.join(', ')}.`, `Por ejemplo: ${job.mismatchExamples.join(', ')}.`) }}</template>
            </p>
            <p v-if="job.failed > 0" class="mt-2 text-[12.5px] text-warning-text">
              {{ t(`Invoices whose original could not be fetched: ${job.failed}. Start again to retry them.`, `Facturas cuyo original no se pudo traer: ${job.failed}. Inícialo de nuevo para reintentarlas.`) }}
            </p>
            <p v-if="job.notHere > 0" class="mt-2 text-[12.5px] text-ink-faint" data-cy="ph-invoices-not-here">
              {{ t(`Invoices in PracticeHub that are not imported here, so there was nothing to file them with: ${job.notHere}. Run Ledger and start again.`, `Facturas de PracticeHub que no están importadas aquí, así que no había con qué guardarlas: ${job.notHere}. Ejecuta Libro mayor y vuelve a iniciar.`) }}
            </p>
          </template>
        </div>

        <div class="flex flex-wrap gap-2">
          <UiBtn v-if="!running" variant="primary" :disabled="busy || Boolean(status.code) || status.invoiceOriginals.invoices === 0" data-cy="ph-invoices-start" @click="act({ op: 'invoices_start' })">
            {{ job.status === 'idle' ? t('Bring the invoice originals', 'Traer los originales de las facturas') : t('Run again', 'Ejecutar de nuevo') }}
          </UiBtn>
          <UiBtn v-else variant="secondary" :disabled="busy" @click="act({ op: 'invoices_stop' })">{{ t('Stop', 'Parar') }}</UiBtn>
        </div>
      </ImportPracticeHubWebSignIn>

      <p v-if="error" class="mt-3 text-[12.5px] text-danger-text" data-cy="ph-web-error">{{ error }}</p>
    </template>
  </div>
</template>
