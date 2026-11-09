<script setup lang="ts">
import type { DocField } from '~/utils/docFields'

// One of a patient's forms, answers only, on a page of its own -- so it can
// sit in a browser tab beside the patient's record while a practitioner
// writes the assessment note. Opened from "View answers" in the patient's
// Attachments. That button used to open the PATIENT's link instead, which
// for a completed form shows nothing but "Thank you".
//
// Read-only on purpose: the form is edited in place in Attachments, and two
// editable copies of it open at once would save over each other.
const t = useT()
const route = useRoute()
const supabase = useSupabaseClient()
const { formatLongDate } = useDates()
const logAccess = useAccessLog()
const docId = route.params.id as string

interface DocRow {
  id: string
  title: string
  fields: DocField[]
  completed_at: string | null
  updated_at: string
  patient_id: string
  patients: { first_name: string | null; last_name: string | null } | null
}
const doc = ref<DocRow | null>(null)
const loading = ref(true)

const patientName = computed(() => `${doc.value?.patients?.first_name ?? ''} ${doc.value?.patients?.last_name ?? ''}`.trim())
// The tab's own title is how it is found again among the others.
useHead({ title: computed(() => (doc.value ? `${doc.value.title} · ${patientName.value}` : t('Form', 'Formulario'))) })

onMounted(async () => {
  const { data } = await supabase
    .from('patient_docs')
    .select('id, title, fields, completed_at, updated_at, patient_id, patients(first_name, last_name)')
    .eq('id', docId)
    .maybeSingle()
  doc.value = (data as unknown as DocRow) ?? null
  loading.value = false
  if (doc.value) logAccess('file_viewed', doc.value.patient_id, { doc: doc.value.title })
})

const meta = computed(() => {
  if (!doc.value) return ''
  const status = doc.value.completed_at
    ? `${t('Completed', 'Completado')} ${formatLongDate(doc.value.completed_at)}`
    : t('Awaiting patient', 'Pendiente del paciente')
  return patientName.value ? `${patientName.value} · ${status}` : status
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="doc?.title ?? t('Form', 'Formulario')" :meta="meta">
      <!-- A link (it goes somewhere, and opens in a new tab on request),
           drawn as UiBtn's secondary button like the header actions elsewhere. -->
      <NuxtLink
        v-if="doc"
        :to="`/patients/${doc.patient_id}?tab=attachments`"
        class="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 outline-none hover:border-line-controlHover focus-visible:shadow-focus touch:h-11"
      >
        <UiChevron />{{ t('Patient record', 'Ficha del paciente') }}
      </NuxtLink>
    </PageHeader>
    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <UiEmptyState
        v-if="!loading && !doc"
        :title="t('Form not found', 'Formulario no encontrado')"
        :description="t('This form does not exist, or your role cannot see it.', 'Este formulario no existe o tu rol no puede verlo.')"
        data-cy="doc-not-found"
      >
        <template #icon>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 2.75h6.5l3.5 3.5v11H5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <path d="M11.5 2.75v3.5H15M7.5 10.5h5M7.5 13.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </template>
        <template #actions>
          <UiBtn @click="navigateTo('/patients')"><UiChevron />{{ t('Back to patients', 'Volver a pacientes') }}</UiBtn>
        </template>
      </UiEmptyState>
      <div v-else class="mx-auto max-w-2xl rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
        <div v-if="loading" class="space-y-3">
          <UiSkeleton class="h-4 w-1/3 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-full rounded-ctlSm" />
          <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
        </div>
        <PatientsDocAnswers v-else-if="doc" :fields="Array.isArray(doc.fields) ? doc.fields : []" />
      </div>
    </div>
  </div>
</template>
