<script setup lang="ts">
// "Informe de revisión" on the record's Progreso tab: the tab turned into the
// PDF handed over at the re-exam (utils/reportPdf: the figures and the table
// as text, the curve as an image). The web's alone, and kept out of
// ProgressTab.vue, which the staff app shares: reportPdf's html-to-image and
// pdf-lib are not in the app's dependencies, and the account store it reads
// is not in the app at all. Handed to the tab through its `report` slot.
const props = defineProps<{
  root: HTMLElement | null
  plan: { name: string; total: number; done: number } | null
  patient: { first_name: string | null; last_name: string | null; clinic_id: string | null }
  disabled: boolean
}>()

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const toast = useToast()

const busy = ref(false)
// What the last file held, for the e2e spec (as components/reports/PdfButton).
const lastResult = ref('')

const patientName = computed(() => `${props.patient.first_name ?? ''} ${props.patient.last_name ?? ''}`.trim())
async function report() {
  if (!props.root || busy.value) return
  busy.value = true
  try {
    const clinic = store.clinics.find((c) => c.id === props.patient.clinic_id) ?? store.clinics.find((c) => c.logo_storage_path)
    const logoUrl = clinic?.logo_storage_path ? supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path).data.publicUrl : null
    const title = t(`Progress report · ${patientName.value}`, `Informe de revisión · ${patientName.value}`)
    // utils/reportPdf pulls in pdf-lib and html-to-image, ~245 KB gzipped, so it
    // is fetched when the button is pressed, not with the page.
    const { downloadReportPdf, pdfFileName } = await import('~/utils/reportPdf')
    const result = await downloadReportPdf(props.root, {
      title,
      lines: [
        [store.accountName, clinic?.name].filter(Boolean).join(' · '),
        props.plan ? t(`${props.plan.name}: ${props.plan.done} of ${props.plan.total} visits`, `${props.plan.name}: ${props.plan.done} de ${props.plan.total} visitas`) : t('No care plan', 'Sin plan de cuidados'),
      ],
      generatedBy: store.teamMember?.full_name ?? '',
      logoUrl,
      fileName: pdfFileName(title, new Date().toISOString().slice(0, 10)),
    })
    lastResult.value = JSON.stringify(result)
  } catch (e) {
    toast.showToast(t('The PDF could not be made: ', 'No se ha podido generar el PDF: ') + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiBtn :disabled="busy || disabled" data-cy="progress-report" :data-pdf-result="lastResult" @click="report">
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
    {{ busy ? t('Preparing…', 'Preparando…') : t('Progress report', 'Informe de revisión') }}
  </UiBtn>
</template>
