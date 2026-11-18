<script setup lang="ts">
import { PRACTICEHUB_STEPS } from '~/utils/practicehubImport/types'

// "Sync everything": reads PracticeHub and runs Patients, Appointments,
// Appointment types, Ledger and Bonos after it, in the order they depend on
// each other, as one job on QuiroFlow's server (server/utils/importJobs.ts).
// Nobody has to keep a tab open through a dozen steps any more, and a clinic
// still keying its work into PracticeHub can be brought up to date again with
// one button -- every step writes only what is missing or changed.
//
// "Preview" runs the same job with dryRun: every step plans against what is
// here and writes nothing, and the result says what each would have written.
//
// The clinical steps, forms and files still run from their own screens.
const t = useT()
const store = useAccountStore()
const connection = usePracticeHubConnection()
const { job, start, cancel } = useImportJob('practicehub')

const confirming = ref<'sync' | 'preview' | null>(null)
const error = ref('')
const starting = ref(false)

onMounted(() => { loadSavedPracticeHubConnection() })

const running = computed(() => importJobActive(job.value))
const clinicName = computed(() => store.currentClinic?.name ?? '')

async function go(dryRun: boolean) {
  confirming.value = null
  starting.value = true
  error.value = ''
  try {
    await start(['read', ...PRACTICEHUB_STEPS], { dryRun })
  } catch (e: any) {
    error.value = importErrorText(e, t, { en: 'The sync could not start.', es: 'No se pudo empezar la sincronización.' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="space-y-4" data-cy="ph-full">
    <ImportIntro
      :lead="t('Reads PracticeHub and brings across patients, appointments, appointment types, payments and invoices, and bonos, in that order. It runs on QuiroFlow\'s server, so you can close this page; you get an email when it is done.', 'Lee PracticeHub y trae pacientes, citas, tipos de cita, pagos y facturas, y bonos, en ese orden. Se hace en el servidor de QuiroFlow, así que puedes cerrar esta página; te llega un email cuando termine.')"
      :notes="[
        { title: t('Safe to run again.', 'Se puede repetir.'), body: t('Running it again brings across only what changed in PracticeHub since: nothing is duplicated, and what QuiroFlow has already changed (a visit moved or checked in here, a bono session taken here) is kept.', 'Al repetirla solo trae lo que haya cambiado en PracticeHub desde entonces: no se duplica nada, y se respeta lo que ya se haya cambiado en QuiroFlow (una visita movida o registrada aquí, una sesión de bono gastada aquí).') },
        { title: t('Want to check first?', '¿Prefieres revisar antes?'), body: t('Preview does the same work and writes nothing: each step then says what it would change.', 'La vista previa hace lo mismo sin escribir nada: cada paso dice qué cambiaría.') },
        { title: t('Not included yet.', 'Aún no incluido.'), body: t('Clinical notes, care plans, logs, sticky notes, forms, files and profile photos: run those from their own steps in the list.', 'Notas clínicas, planes, registros, notas adhesivas, formularios, archivos y fotos de perfil: hazlos desde sus propios pasos de la lista.') },
      ]"
    />

    <p v-if="!connection" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Save the PracticeHub connection first, in Connection.', 'Guarda antes la conexión con PracticeHub, en Conexión.') }}
    </p>
    <p v-else-if="!store.currentClinicId" class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[13px] text-warning-text">
      {{ t('Choose the clinic to import into, in the clinic switcher in the sidebar.', 'Elige la clínica a la que importar, en el selector de clínica de la barra lateral.') }}
    </p>

    <template v-else-if="!running">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-md border border-line-control bg-surface px-4 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="starting" data-cy="ph-full-preview" @click="confirming = 'preview'">
          {{ t('Preview (writes nothing)', 'Vista previa (no escribe nada)') }}
        </button>
        <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="starting" data-cy="ph-full-start" @click="confirming = 'sync'">
          {{ t('Sync everything', 'Sincronizar todo') }}
        </button>
      </div>
      <p v-if="error" class="text-sm text-danger-text">{{ error }}</p>
    </template>

    <ImportQuirocitasJob v-if="job" :job="job" @cancel="cancel" />

    <UiConfirmDialog
      v-if="confirming"
      :title="confirming === 'preview' ? t('Preview a sync from PracticeHub?', '¿Ver qué cambiaría una sincronización de PracticeHub?') : t('Sync everything from PracticeHub?', '¿Sincronizar todo de PracticeHub?')"
      :confirm-label="confirming === 'preview' ? t('Preview', 'Ver vista previa') : t('Sync everything', 'Sincronizar todo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="go(confirming === 'preview')"
      @cancel="confirming = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">
        <template v-if="confirming === 'preview'">
          {{ t('Reads everything from PracticeHub and works out, step by step, what a sync would change here. Nothing is written. It usually takes ten to twenty minutes; you can close this page.', 'Lee todo de PracticeHub y calcula, paso a paso, qué cambiaría aquí una sincronización. No se escribe nada. Suele tardar entre diez y veinte minutos; puedes cerrar esta página.') }}
        </template>
        <template v-else>
          {{ clinicName
            ? t(`Reads everything from PracticeHub and brings it into ${clinicName}. It usually takes ten to thirty minutes; you can close this page.`, `Lee todo de PracticeHub y lo trae a ${clinicName}. Suele tardar entre diez y treinta minutos; puedes cerrar esta página.`)
            : t('Reads everything from PracticeHub and brings it across. It usually takes ten to thirty minutes; you can close this page.', 'Lee todo de PracticeHub y lo trae. Suele tardar entre diez y treinta minutos; puedes cerrar esta página.') }}
        </template>
      </p>
    </UiConfirmDialog>
  </div>
</template>
