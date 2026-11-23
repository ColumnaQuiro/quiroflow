<script setup lang="ts">
import { QUIROHIRO_STEPS } from '~/utils/quirohiroImport'

// "Import everything": reads QuiroHiro and runs every import step after it --
// patients, appointments, then clinical records and notes -- as one job on
// QuiroFlow's server (server/utils/quirohiroImportJob.ts). Pressed again
// later it brings across only what changed in QuiroHiro since, which is how a
// clinic still working there for a few days is kept up to date.
//
// "Preview" runs the same job with dryRun: every step plans against what is
// here and writes nothing, and the result says what each would have written.
const t = useT()
const store = useAccountStore()
const connection = useQuirohiroConnection()
const { job, start, cancel } = useImportJob('quirohiro')

const who = ref<'patients' | 'everyone'>('patients')
const quietUpcoming = ref(true)
const confirming = ref<'import' | 'preview' | null>(null)
const error = ref('')
const starting = ref(false)

onMounted(() => { loadQuirohiroConnection() })

const running = computed(() => importJobActive(job.value))
const imported = computed(() => job.value?.status === 'done' && !(job.value.options as { dryRun?: boolean } | null)?.dryRun)
const clinicName = computed(() => store.currentClinic?.name ?? '')

async function go(dryRun: boolean) {
  confirming.value = null
  starting.value = true
  error.value = ''
  try {
    await start(['read', ...QUIROHIRO_STEPS], { dryRun, who: who.value, quietUpcoming: quietUpcoming.value })
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The import could not start.', es: 'No se pudo empezar la importación.' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="space-y-4" data-cy="qh-full">
    <ImportIntro
      :lead="t('Reads QuiroHiro and brings it across: patients, appointments, each patient\'s clinical record and visit notes, and payments, in that order. It runs on QuiroFlow\'s server, so you can close this page; you get an email when it is done.', 'Lee QuiroHiro y lo trae: pacientes, citas, la ficha clínica y las notas de visita de cada paciente, y los pagos, en ese orden. Se hace en el servidor de QuiroFlow, así que puedes cerrar esta página; te llega un email cuando termine.')"
      :notes="[
        { title: t('Safe to run again.', 'Se puede repetir.'), body: t('Running it again brings across only what changed in QuiroHiro since: nothing is duplicated, and what QuiroFlow has already changed (a visit moved or checked in here) is kept.', 'Al repetirla solo trae lo que haya cambiado en QuiroHiro desde entonces: no se duplica nada, y se respeta lo que ya se haya cambiado en QuiroFlow (una visita movida o registrada aquí).') },
        { title: t('Notes find their visit.', 'Las notas van a su visita.'), body: t('A note written on the day of a visit becomes that visit\'s note; one written on another day goes on the patient\'s history. The clinical custom fields become one record per patient.', 'Una nota escrita el día de una visita queda como nota de esa visita; una escrita otro día va al historial del paciente. Los campos clínicos personalizados quedan en una ficha por paciente.') },
        { title: t('Payments, invoices and bonos.', 'Pagos, facturas y bonos.'), body: t('If the clinic charges through QuiroHiro and the key has the two payment permissions, its invoices, payments and bonos come in last. A clinic that keeps its money elsewhere (a spreadsheet) has none there to bring.', 'Si la clínica cobra con QuiroHiro y la clave tiene los dos permisos de pagos, sus facturas, pagos y bonos llegan al final. Una clínica que lleva el dinero en otro sitio (un Excel) no tiene nada que traer de ahí.') },
      ]"
    />

    <p v-if="!quirohiroConnected(connection)" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the QuiroHiro connection first, in Connection.', 'Guarda antes la conexión con QuiroHiro, en Conexión.') }}
    </p>
    <p v-else-if="!store.currentClinicId" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Choose the clinic to import into, in the clinic switcher in the sidebar.', 'Elige la clínica a la que importar, en el selector de clínica de la barra lateral.') }}
    </p>

    <template v-else-if="!running">
      <fieldset class="space-y-2" data-cy="qh-who">
        <legend class="text-sm font-medium text-ink-700">{{ t('Who comes in', 'A quién se importa') }}</legend>
        <label class="flex items-start gap-2 text-[13px] text-ink-700">
          <input v-model="who" type="radio" value="patients" class="mt-0.5" data-cy="qh-who-patients" />
          <span>
            <strong class="font-medium text-ink-900">{{ t('Only patients', 'Solo pacientes') }}</strong>
            · {{ t('contacts marked as patients in QuiroHiro, with an appointment, or with something in their clinical record. Leads from ads and WhatsApp stay out.', 'los contactos marcados como pacientes en QuiroHiro, con alguna cita o con algo en su ficha clínica. Los leads de anuncios y WhatsApp se quedan fuera.') }}
          </span>
        </label>
        <label class="flex items-start gap-2 text-[13px] text-ink-700">
          <input v-model="who" type="radio" value="everyone" class="mt-0.5" data-cy="qh-who-everyone" />
          <span>
            <strong class="font-medium text-ink-900">{{ t('Everyone', 'Todos') }}</strong>
            · {{ t('every contact, leads included, as patients here.', 'todos los contactos, leads incluidos, como pacientes aquí.') }}
          </span>
        </label>
      </fieldset>
      <label class="flex items-start gap-2 text-[13px] text-ink-700">
        <input v-model="quietUpcoming" type="checkbox" class="mt-0.5" data-cy="qh-full-quiet-upcoming" />
        <span>{{ t('QuiroHiro is still sending reminders: do not send them from QuiroFlow for the upcoming visits imported now.', 'QuiroHiro aún envía los recordatorios: no enviarlos desde QuiroFlow para las próximas visitas que se importan ahora.') }}</span>
      </label>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-md border border-line-control bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="starting" data-cy="qh-full-preview" @click="confirming = 'preview'">
          {{ t('Preview (writes nothing)', 'Vista previa (no escribe nada)') }}
        </button>
        <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="starting" data-cy="qh-full-start" @click="confirming = 'import'">
          {{ imported ? t('Import everything again (sync)', 'Volver a importar todo (sincronizar)') : t('Import everything', 'Importar todo') }}
        </button>
      </div>
      <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    </template>

    <ImportQuirocitasJob v-if="job" :job="job" @cancel="cancel" />

    <UiConfirmDialog
      v-if="confirming"
      :title="confirming === 'preview' ? t('Preview an import from QuiroHiro?', '¿Ver qué cambiaría una importación de QuiroHiro?') : t('Import everything from QuiroHiro?', '¿Importar todo de QuiroHiro?')"
      :confirm-label="confirming === 'preview' ? t('Preview', 'Ver vista previa') : t('Import everything', 'Importar todo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="go(confirming === 'preview')"
      @cancel="confirming = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        <template v-if="confirming === 'preview'">
          {{ t('Reads everything from QuiroHiro and works out, step by step, what an import would change here. Nothing is written. It usually takes five to ten minutes; you can close this page.', 'Lee todo de QuiroHiro y calcula, paso a paso, qué cambiaría aquí una importación. No se escribe nada. Suele tardar entre cinco y diez minutos; puedes cerrar esta página.') }}
        </template>
        <!-- The button only shows once a clinic is chosen, so there is always a name. -->
        <template v-else-if="who === 'everyone'">
          {{ t(`Reads QuiroHiro and brings every contact, leads included, with their appointments, records and notes, into ${clinicName}. It usually takes ten to fifteen minutes; you can close this page.`, `Lee QuiroHiro y trae todos sus contactos, leads incluidos, con sus citas, fichas y notas, a ${clinicName}. Suele tardar entre diez y quince minutos; puedes cerrar esta página.`) }}
        </template>
        <template v-else>
          {{ t(`Reads QuiroHiro and brings its patients, with their appointments, records and notes, into ${clinicName}. It usually takes ten to fifteen minutes; you can close this page.`, `Lee QuiroHiro y trae sus pacientes, con sus citas, fichas y notas, a ${clinicName}. Suele tardar entre diez y quince minutos; puedes cerrar esta página.`) }}
        </template>
      </p>
    </UiConfirmDialog>
  </div>
</template>
