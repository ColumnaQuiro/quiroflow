<script setup lang="ts">
import type { QuirocitasPlan, QuirocitasStepKind } from '~/composables/useQuirocitasImport'

// One import step, any of them: prepare a preview from the copy the Read step
// made, show it, write it on Apply. What each step maps and writes is in
// composables/useQuirocitasImport.ts; this is only the screen around it, the
// same shape for all of them so each can be trusted without reading the code.
const props = defineProps<{ kind: QuirocitasStepKind }>()

const t = useT()
const store = useAccountStore()
const snapshot = useQuirocitasSnapshot()
const { plan: buildPlan } = useQuirocitasImport()
const nf = new Intl.NumberFormat('es-ES')

const stage = ref<'idle' | 'planning' | 'preview' | 'applying' | 'done' | 'error'>('idle')
useImportWriting(() => stage.value === 'applying')
const plan = shallowRef<QuirocitasPlan | null>(null)
const error = ref('')
const done = ref(0)
const stopping = ref(false)
const result = ref<{ written: number; errors: string[] } | null>(null)
// Quirocitas keeps reminding its patients until the clinic switches over, so
// by default the visits still to come are marked as already reminded here.
const quietUpcoming = ref(true)

onMounted(() => { if (store.accountId) loadQuirocitasSnapshot(store.accountId) })
watch(() => props.kind, () => { stage.value = 'idle'; plan.value = null; result.value = null })

const INTRO: Record<QuirocitasStepKind, { lead: () => string; notes: () => { title: string; body: string }[] }> = {
  patients: {
    lead: () => t('Every patient with their details, phones, consent and chiropractor. Runs first: everything after it finds its patient by the Quirocitas reference stored here.', 'Cada paciente con sus datos, teléfonos, consentimiento y quiropráctico. Va primero: todo lo demás encuentra a su paciente por la referencia de Quirocitas guardada aquí.'),
    notes: () => [
      { title: t('Catalan.', 'Catalán.'), body: t('QuiroFlow does not send messages in Catalan: those patients get Spanish and a "Català" tag.', 'QuiroFlow no envía mensajes en catalán: esos pacientes quedan en español con la etiqueta "Català".') },
      { title: t('"No enviar mensajes".', '"No enviar mensajes".'), body: t('Turns off automatic reminders and confirmations for that patient, without marking them as not to be contacted.', 'Desactiva los recordatorios y confirmaciones automáticos de ese paciente, sin marcarlo como "no contactar".') },
      { title: t('Safe to run again.', 'Se puede repetir.'), body: t('A patient already here is updated, never duplicated; phone numbers are only ever added.', 'Un paciente que ya está se actualiza, nunca se duplica; los teléfonos solo se añaden.') },
    ],
  },
  appointments: {
    lead: () => t('Past and upcoming visits, missed and cancelled ones included, with their type and chiropractor.', 'Visitas pasadas y futuras, faltas y anulaciones incluidas, con su tipo y quiropráctico.'),
    notes: () => [
      { title: t('Calls are not visits.', 'Las llamadas no son visitas.'), body: t('Quirocitas books follow-up calls ("Charla") as appointments; they come in as calls in the patient\'s contact history, with the "Clinical history and calls" step.', 'Quirocitas apunta las llamadas de seguimiento ("Charla") como citas; llegan como llamadas en el historial de contacto, con el paso "Historial clínico y llamadas".') },
      { title: t('QuiroFlow wins once it has acted.', 'Manda QuiroFlow si ya actuó.'), body: t('A visit moved, checked in or closed here is kept as it is on a re-run.', 'Una visita movida, registrada o cerrada aquí se mantiene al repetir.') },
    ],
  },
  clinical: {
    lead: () => t('The note written at each visit, with the spinal segments adjusted at it; the history summary, treatment plans and anamnesis; and every follow-up call.', 'La nota de cada visita, con los segmentos ajustados; el resumen del historial, los planes de tratamiento y la anamnesis; y cada llamada de seguimiento.'),
    notes: () => [{ title: t('Needs Appointments.', 'Requiere Citas.'), body: t('Each note is attached to its visit, so run Appointments first.', 'Cada nota se une a su visita: ejecuta Citas antes.') }],
  },
  bonos: {
    lead: () => t('Every bono with its sessions used, price, what is still owed, and the family it is shared with.', 'Cada bono con sus sesiones usadas, precio, lo pendiente y la familia con quien se comparte.'),
    notes: () => [
      { title: t('Shared bonos once.', 'Bonos compartidos una vez.'), body: t('Quirocitas lists a family bono on every member; it comes in once, owned by whoever paid for it, and shared with the rest.', 'Quirocitas muestra un bono familiar en cada miembro; llega una vez, del que lo pagó, compartido con el resto.') },
      { title: t('Sessions only rise.', 'Las sesiones solo suben.'), body: t('A session used here is never undone by a re-run.', 'Una sesión usada aquí nunca se deshace al repetir.') },
    ],
  },
  ledger: {
    lead: () => t('The cash ledger since it began: what each visit was worth, every payment by cash, card or transfer, and the invoices Quirocitas issued.', 'La caja desde su inicio: lo que valió cada visita, cada pago en efectivo, tarjeta o transferencia, y las facturas que emitió Quirocitas.'),
    notes: () => [
      { title: t('Never sent to VeriFactu.', 'Nunca se envía a VeriFactu.'), body: t('Imported invoices are history, numbered "QC-…" as Quirocitas numbered them. They come in paid, unless Quirocitas still shows money owed on the visit.', 'Las facturas importadas son historial, numeradas "QC-…" como en Quirocitas. Llegan pagadas, salvo que Quirocitas aún muestre dinero pendiente en la visita.') },
      { title: t('Needs Patients, Appointments and Bonos.', 'Requiere Pacientes, Citas y Bonos.'), body: t('Charges sit on their visit and bono payments on their bono.', 'Los cargos van en su visita y los pagos de bono en su bono.') },
    ],
  },
  files: {
    lead: () => t('Scans, x-rays and PDFs attached in Quirocitas, and each patient\'s photo.', 'Escaneos, radiografías y PDF adjuntos en Quirocitas, y la foto de cada paciente.'),
    notes: () => [{ title: t('Skips what is here.', 'Se salta lo que ya está.'), body: t('A file already copied is not copied again; stopping and carrying on is safe.', 'Un archivo ya copiado no se vuelve a copiar; se puede parar y seguir.') }],
  },
}

async function prepare() {
  if (!snapshot.value) return
  stage.value = 'planning'
  error.value = ''
  try {
    plan.value = await buildPlan(props.kind, snapshot.value, { quietUpcoming: quietUpcoming.value })
    stage.value = 'preview'
  } catch (e: any) {
    error.value = e?.message ?? String(e)
    stage.value = 'error'
  }
}

async function apply() {
  if (!plan.value) return
  stage.value = 'applying'
  stopping.value = false
  done.value = 0
  try {
    result.value = await plan.value.apply((n) => { done.value = n }, () => stopping.value)
    stage.value = 'done'
  } catch (e: any) {
    error.value = e?.message ?? String(e)
    stage.value = 'error'
  }
}
</script>

<template>
  <div class="space-y-4" :data-cy="`qc-step-${kind}`">
    <ImportIntro :lead="INTRO[kind].lead()" :notes="INTRO[kind].notes()" />

    <p v-if="!snapshot" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Read Quirocitas first: every step imports from that copy.', 'Lee antes Quirocitas: cada paso importa desde esa copia.') }}
    </p>

    <template v-else-if="stage === 'idle' || stage === 'error'">
      <label v-if="kind === 'appointments'" class="flex items-start gap-2 text-[13px] text-ink-700">
        <input v-model="quietUpcoming" type="checkbox" class="mt-0.5" data-cy="qc-quiet-upcoming" />
        <span>{{ t('Quirocitas is still sending reminders: do not send them from QuiroFlow for the upcoming visits imported now.', 'Quirocitas aún envía los recordatorios: no enviarlos desde QuiroFlow para las próximas visitas que se importan ahora.') }}</span>
      </label>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" data-cy="qc-prepare" @click="prepare">
        {{ t('Prepare preview', 'Preparar vista previa') }}
      </button>
      <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    </template>

    <p v-else-if="stage === 'planning'" class="text-[13px] text-ink-muted2">{{ t('Comparing with what is already here…', 'Comparando con lo que ya hay…') }}</p>

    <ImportPreviewPanel
      v-else-if="stage === 'preview' && plan"
      :stats="plan.stats"
      :columns="plan.columns"
      :rows="plan.rows"
      :apply-label="t('Apply', 'Aplicar')"
      :more-label="t('more', 'más')"
      :apply-disabled="plan.total === 0"
      @apply="apply"
      @cancel="stage = 'idle'"
    >
      <template #warning>
        <ul v-if="plan.warnings.length" class="space-y-2" data-cy="qc-warnings">
          <li v-for="w in plan.warnings" :key="w" class="rounded-ctl border border-line-divider bg-surface-subtle p-3 text-[12.5px] leading-relaxed text-ink-600">{{ w }}</li>
        </ul>
        <p v-if="plan.total === 0" class="text-[13px] text-success-text">{{ t('Everything is already here. Nothing to write.', 'Ya está todo aquí. No hay nada que escribir.') }}</p>
      </template>
    </ImportPreviewPanel>

    <div v-else-if="stage === 'applying' && plan" class="space-y-2" data-cy="qc-applying">
      <div class="h-2 overflow-hidden rounded-full bg-surface-subtle"><div class="h-full bg-brand transition-all" :style="{ width: `${Math.round((done / Math.max(plan.total, 1)) * 100)}%` }" /></div>
      <div class="flex items-center gap-3 text-[13px] text-ink-muted2">
        <span>{{ t(`${nf.format(done)} of ${nf.format(plan.total)}`, `${nf.format(done)} de ${nf.format(plan.total)}`) }}</span>
        <button type="button" class="font-medium text-ink-700 hover:underline disabled:opacity-50" :disabled="stopping" @click="stopping = true">{{ stopping ? t('Stopping…', 'Parando…') : t('Stop', 'Parar') }}</button>
      </div>
    </div>

    <div v-else-if="stage === 'done' && result" class="space-y-2" data-cy="qc-done">
      <p class="text-sm" :class="result.errors.length ? 'text-warning-text' : 'text-success-text'">
        {{ stopping ? t(`Stopped after saving ${nf.format(result.written)}. Prepare the preview again to carry on.`, `Parado tras guardar ${nf.format(result.written)}. Vuelve a preparar la vista previa para seguir.`) : result.errors.length ? t(`Finished: ${nf.format(result.written)} saved, with the problems below.`, `Terminado: ${nf.format(result.written)} guardados, con los problemas de abajo.`) : t(`Done: ${nf.format(result.written)} saved.`, `Hecho: ${nf.format(result.written)} guardados.`) }}
      </p>
      <ul v-if="result.errors.length" class="max-h-60 space-y-1 overflow-y-auto rounded-ctl border border-line-divider p-3 text-[12.5px] text-danger-text">
        <li v-for="(e, i) in result.errors.slice(0, 100)" :key="i">{{ e }}</li>
      </ul>
      <button type="button" class="text-sm font-medium text-ink-700 hover:underline" @click="prepare">{{ t('Check again', 'Comprobar de nuevo') }}</button>
    </div>
  </div>
</template>
