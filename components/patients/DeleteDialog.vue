<script setup lang="ts">
// Deleting a patient record.
//
// Two things make this more than a confirm(). First, it is a cascade: every
// appointment, note, file and ledger row goes with the patient, and the old
// browser confirm() named only two of those counts.
//
// Second, and the reason this dialog refuses as often as it asks: a patient
// with an issued factura CANNOT be deleted. facturas.patient_id cascades,
// but factura_records.factura_id is RESTRICT, so Postgres rejects the whole
// delete with a foreign-key violation -- which the old flow surfaced as the
// raw message "violates foreign key constraint factura_records_factura_id_fkey".
// That restriction is correct: a factura is a VeriFactu chain-signed fiscal
// record, and removing a link would break the chain for every record after
// it. So the dialog checks first and offers Archive instead, rather than
// letting a clinic press a button that cannot work.
const props = defineProps<{ patientId: string; patientName: string; archived: boolean }>()
const emit = defineEmits<{ close: []; deleted: []; archive: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const counting = ref(true)
const deleting = ref(false)
const error = ref('')
const typed = ref('')
const counts = ref({ appointments: 0, invoices: 0, files: 0, facturas: 0 })

const blockedByFacturas = computed(() => counts.value.facturas > 0)
const canDelete = computed(
  () => !blockedByFacturas.value && typed.value.trim().toLowerCase() === props.patientName.trim().toLowerCase(),
)

onMounted(async () => {
  const head = { count: 'exact' as const, head: true }
  // No note count: visit_notes is keyed by appointment, not by patient, so
  // there is no single head-count for it. The copy covers them instead --
  // they go when their appointment does.
  const [appointments, invoices, files, facturas] = await Promise.all([
    supabase.from('appointments').select('id', head).eq('patient_id', props.patientId),
    supabase.from('invoices').select('id', head).eq('patient_id', props.patientId),
    supabase.from('patient_files').select('id', head).eq('patient_id', props.patientId),
    supabase.from('facturas').select('id', head).eq('patient_id', props.patientId),
  ])
  counts.value = {
    appointments: appointments.count ?? 0,
    invoices: invoices.count ?? 0,
    files: files.count ?? 0,
    facturas: facturas.count ?? 0,
  }
  counting.value = false
})

async function remove() {
  if (!canDelete.value || deleting.value) return
  deleting.value = true
  error.value = ''
  const { error: deleteError } = await supabase.from('patients').delete().eq('id', props.patientId)
  deleting.value = false
  if (deleteError) {
    error.value = deleteError.message
    return
  }
  showToast(t('Patient deleted', 'Paciente eliminado'))
  emit('deleted')
}

const lines = computed(() =>
  [
    { key: 'appointments', n: counts.value.appointments, label: t('appointment', 'cita'), plural: t('appointments', 'citas') },
    { key: 'invoices', n: counts.value.invoices, label: t('receipt', 'recibo'), plural: t('receipts', 'recibos') },
    { key: 'files', n: counts.value.files, label: t('file', 'archivo'), plural: t('files', 'archivos') },
  ].filter((l) => l.n > 0),
)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/30 p-0 lg:items-center lg:p-6" @click.self="emit('close')">
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('Delete patient', 'Eliminar paciente')"
      class="max-h-[92vh] w-full overflow-y-auto rounded-t-card border border-line bg-surface p-5 shadow-popover lg:max-w-[520px] lg:rounded-card"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
    >
      <div v-if="counting" class="flex flex-col gap-2.5">
        <UiSkeleton class="h-5 w-48 rounded" />
        <UiSkeleton class="h-3.5 w-full rounded" />
        <UiSkeleton class="h-3.5 w-2/3 rounded" />
      </div>

      <!-- The refusal. Not a disabled button: an explanation. -->
      <template v-else-if="blockedByFacturas">
        <h2 class="text-[17px] font-semibold tracking-tightTitle text-ink-900">
          {{ t('This record cannot be deleted', 'Esta ficha no se puede eliminar') }}
        </h2>
        <p class="mt-2.5 text-[13.5px] leading-[1.6] text-ink-700">
          {{
            t(
              `${patientName} has ${counts.facturas} issued factura${counts.facturas === 1 ? '' : 's'}. Facturas are fiscal records, chain-signed under VeriFactu — removing one would break the chain for every record issued after it, so they cannot be deleted and neither can the patient they belong to.`,
              `${patientName} tiene ${counts.facturas} factura${counts.facturas === 1 ? '' : 's'} emitida${counts.facturas === 1 ? '' : 's'}. Las facturas son registros fiscales firmados en cadena conforme a VeriFactu: eliminar una rompería la cadena de todas las posteriores, así que no se pueden borrar, ni tampoco el paciente al que pertenecen.`,
            )
          }}
        </p>
        <p class="mt-2.5 text-[13px] leading-[1.6] text-ink-muted">
          {{
            t(
              'Archiving hides the patient from the active list and stops reminders, while keeping the record intact.',
              'Archivar oculta al paciente de la lista activa y detiene los recordatorios, conservando la ficha intacta.',
            )
          }}
        </p>
        <div class="mt-4 flex flex-col gap-2 lg:flex-row lg:justify-end">
          <button
            type="button"
            class="flex h-9 touch:h-11 items-center justify-center rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
            @click="emit('close')"
          >
            {{ t('Close', 'Cerrar') }}
          </button>
          <button
            v-if="!archived"
            type="button"
            class="flex h-9 touch:h-11 items-center justify-center rounded-ctl bg-brand px-3.5 text-[13.5px] font-semibold text-white outline-none hover:bg-brand-hover focus-visible:shadow-focus lg:h-[34px]"
            @click="emit('archive')"
          >
            {{ t('Archive instead', 'Archivar en su lugar') }}
          </button>
        </div>
      </template>

      <template v-else>
        <h2 class="text-[17px] font-semibold tracking-tightTitle text-ink-900">
          {{ t(`Delete ${patientName}?`, `¿Eliminar a ${patientName}?`) }}
        </h2>
        <p class="mt-2.5 text-[13.5px] leading-[1.6] text-ink-700">
          {{ t('This is permanent and cannot be undone. It also deletes:', 'Es permanente y no se puede deshacer. También elimina:') }}
        </p>
        <ul v-if="lines.length" class="mt-2.5 flex flex-col gap-1.5">
          <li v-for="line in lines" :key="line.key" class="flex items-center gap-2 text-[13px] text-ink-700">
            <span class="h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span><span class="font-mono font-semibold">{{ line.n }}</span> {{ line.n === 1 ? line.label : line.plural }}</span>
          </li>
        </ul>
        <p v-else class="mt-2.5 text-[13px] text-ink-muted">
          {{ t('Nothing else is attached to this record yet.', 'No hay nada más asociado a esta ficha todavía.') }}
        </p>
        <p v-if="lines.length" class="mt-2 text-[12.5px] leading-[1.55] text-ink-muted">
          {{
            t(
              'Clinical notes and messages go with the appointments they belong to.',
              'Las notas clínicas y los mensajes se eliminan junto con las citas a las que pertenecen.',
            )
          }}
        </p>

        <label class="mt-4 block">
          <span class="block text-[13px] font-medium text-ink-700">
            {{ t(`Type ${patientName} to confirm`, `Escribe ${patientName} para confirmar`) }}
          </span>
          <input
            v-model="typed"
            type="text"
            autocomplete="off"
            class="mt-1.5 h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 outline-none focus:border-brand focus:shadow-focus lg:h-[38px] lg:text-[14px]"
          />
        </label>

        <p v-if="error" role="alert" class="mt-2.5 text-[12.5px] text-danger-text">{{ error }}</p>

        <div class="mt-4 flex flex-col gap-2 lg:flex-row lg:justify-end">
          <button
            type="button"
            class="flex h-9 touch:h-11 items-center justify-center rounded-ctl border border-line-control px-3.5 text-[13.5px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus lg:h-[34px]"
            @click="emit('close')"
          >
            {{ t('Cancel', 'Cancelar') }}
          </button>
          <button
            type="button"
            :disabled="!canDelete || deleting"
            class="flex h-9 touch:h-11 items-center justify-center rounded-ctl bg-danger-text px-3.5 text-[13.5px] font-semibold text-white outline-none focus-visible:shadow-focusDanger disabled:cursor-not-allowed disabled:opacity-50 lg:h-[34px]"
            @click="remove"
          >
            {{ deleting ? t('Deleting…', 'Eliminando…') : t('Delete permanently', 'Eliminar permanentemente') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
