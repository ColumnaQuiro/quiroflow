<script setup lang="ts">
// Documents the clinic shared with this patient.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')
const { documents, loading, busyId, open } = usePatientDocuments(() => patientId.value)
</script>

<template>
  <PatientScreen :title="t('Documents', 'Documentos')">
    <PatientCard flush>
      <div v-if="loading" class="space-y-3 p-4">
        <UiSkeleton class="h-10 w-full rounded-ctl" />
      </div>
      <ul v-else-if="documents.length > 0" class="divide-y divide-line-divider">
        <li v-for="file in documents" :key="file.id" class="flex items-center gap-3 px-4 py-3.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-surface-subtle text-ink-muted">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M4 2h5l3 3v9H4zM9 2v3.2h3" /></svg>
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13.5px] font-medium text-ink-900">{{ file.file_name }}</p>
            <p class="text-[12px] text-ink-faint">
              {{ new Date(file.created_at).toLocaleDateString() }}
              <template v-if="fileSizeLabel(file.size_bytes)"> &middot; {{ fileSizeLabel(file.size_bytes) }}</template>
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-ctlSm border border-line-control px-2.5 py-1.5 text-[12px] font-medium text-ink-600 disabled:opacity-50"
            :disabled="busyId === file.id"
            @click="open(file)"
          >
            {{ busyId === file.id ? t('Opening…', 'Abriendo…') : t('Open', 'Abrir') }}
          </button>
        </li>
      </ul>
      <PatientEmpty v-else :text="t('Your clinic has not shared any documents with you yet.', 'Tu clínica todavía no ha compartido ningún documento contigo.')" />
    </PatientCard>
  </PatientScreen>
</template>
