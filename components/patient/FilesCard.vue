<script setup lang="ts">
// Files the clinic has deliberately shared with this patient.
//
// The list is not filtered here: "patients view own custom patient_files"
// (0162) already restricts the table to visibility = 'custom' rows with a
// storage_path, so this selects everything it can see. A front-end filter
// would be a second copy of that rule, and the weaker of the two.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()
const { showToast } = useToast()

interface SharedFile {
  id: string
  file_name: string
  file_type: string | null
  size_bytes: number | null
  created_at: string
}

const files = ref<SharedFile[]>([])
const loading = ref(true)
const busyId = ref<string | null>(null)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patient_files')
    .select('id, file_name, file_type, size_bytes, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  files.value = data ?? []
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

async function open(file: SharedFile) {
  busyId.value = file.id
  try {
    const { url } = await authedFetch<{ url: string }>('/api/patient-files/signed-url', {
      method: 'POST',
      body: { fileId: file.id },
    })
    // A new tab rather than an <a download>: on iOS the app runs in a
    // WKWebView where a download attribute does nothing, and the system
    // viewer handling a PDF is what a patient expects anyway.
    window.open(url, '_blank')
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    showToast(message ?? t('Could not open that file.', 'No se pudo abrir el archivo.'), 'error')
  } finally {
    busyId.value = null
  }
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
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
