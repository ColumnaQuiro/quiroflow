<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'
import { downloadReportPdf, pdfFileName } from '~/utils/reportPdf'

// "Download PDF" on every report and report page. What goes into the file is
// whatever inside `target` carries data-pdf-block (see utils/reportPdf.ts);
// the header states the filters, so a printed copy says what it is of.
const props = defineProps<{
  target: HTMLElement | null
  title: string
  range?: DateRange | null
  /** A single day, for reports about one day. */
  day?: string | null
  practitionerId?: string | null
  clinicId?: string | null
  /** Anything else the report is filtered by, already worded. */
  extra?: string[]
}>()

const emit = defineEmits<{ busy: [on: boolean] }>()
const t = useT()
const store = useAccountStore()
const toast = useToast()
const { reportsPractitionerId } = useOwnScope()
const supabase = useSupabaseClient()
const busy = ref(false)
// What the last file held, for the e2e specs to read -- the bytes themselves
// are compressed and say little to a test.
const lastResult = ref('')

const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

async function nameOf(table: 'team_members' | 'clinics', id: string) {
  if (table === 'clinics') {
    const known = store.clinics.find((c) => c.id === id)
    if (known) return known.name
  }
  const { data } = table === 'clinics'
    ? await supabase.from('clinics').select('name').eq('id', id).maybeSingle()
    : await supabase.from('team_members').select('name:full_name').eq('id', id).maybeSingle()
  return (data as { name?: string } | null)?.name ?? '—'
}

async function lines() {
  const out: string[] = []
  const head = [store.accountName]
  if (props.range) head.push(`${dateLabel(props.range.from)} – ${dateLabel(props.range.to)}`)
  if (props.day) head.push(dateLabel(props.day))
  out.push(head.filter(Boolean).join(' · '))
  const who: string[] = []
  const practitioner = reportsPractitionerId.value ?? props.practitionerId
  if (reportsPractitionerId.value) who.push(t(`Only ${await nameOf('team_members', reportsPractitionerId.value)}'s figures`, `Solo los datos de ${await nameOf('team_members', reportsPractitionerId.value)}`))
  else who.push(practitioner ? await nameOf('team_members', practitioner) : t('All practitioners', 'Todos los profesionales'))
  who.push(props.clinicId ? await nameOf('clinics', props.clinicId) : t('All clinics', 'Todas las clínicas'))
  out.push([...who, ...(props.extra ?? [])].join(' · '))
  return out
}

function logoUrl() {
  const clinic = (props.clinicId && store.clinics.find((c) => c.id === props.clinicId)) || store.clinics.find((c) => c.logo_storage_path)
  return clinic?.logo_storage_path ? supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path).data.publicUrl : null
}

async function download() {
  if (!props.target || busy.value) return
  busy.value = true
  emit('busy', true)
  try {
    const stamp = props.day ?? (props.range ? props.range.to.slice(0, 7) : new Date().toISOString().slice(0, 10))
    const result = await downloadReportPdf(props.target, {
      title: props.title,
      lines: await lines(),
      generatedBy: store.teamMember?.full_name ?? '',
      logoUrl: logoUrl(),
      fileName: pdfFileName(props.title, stamp),
    })
    lastResult.value = JSON.stringify(result)
  } catch (e) {
    toast.showToast(t('The PDF could not be made: ', 'No se ha podido generar el PDF: ') + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <UiBtn data-cy="report-pdf" data-pdf-skip :data-pdf-result="lastResult" :disabled="busy || !target" @click="download">
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
    {{ busy ? t('Preparing…', 'Preparando…') : t('Download PDF', 'Descargar PDF') }}
  </UiBtn>
</template>
