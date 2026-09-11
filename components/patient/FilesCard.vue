<script setup lang="ts">
// Files the clinic has deliberately shared with this patient.
//
// The query and the signed-URL open live in usePatientDocuments, shared
// with the portal's documents page; the RLS policy "patients view own
// custom patient_files" (0162) is what actually decides what is in the
// list, on both.
const props = defineProps<{ patientId: string }>()

const t = useT()
const { documents: files, loading, busyId, open } = usePatientDocuments(() => props.patientId)

const sizeLabel = fileSizeLabel
</script>

<template>
  <section v-if="loading || files.length > 0">
    <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Your documents', 'Tus documentos') }}</h2>
    <div class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
      <div v-if="loading" class="p-4 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
      <ul v-else class="divide-y divide-line">
        <li v-for="file in files" :key="file.id" class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <p class="truncate text-[13.5px] font-medium text-ink-900">{{ file.file_name }}</p>
            <p class="text-[12px] text-ink-faint">
              {{ new Date(file.created_at).toLocaleDateString() }}
              <template v-if="sizeLabel(file.size_bytes)"> &middot; {{ sizeLabel(file.size_bytes) }}</template>
            </p>
          </div>
          <button type="button" class="shrink-0 text-[12.5px] font-medium text-brand-text" :disabled="busyId === file.id" @click="open(file)">
            {{ busyId === file.id ? t('Opening…', 'Abriendo…') : t('Open', 'Abrir') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
