<script setup lang="ts">
// The patient's files on the staff app's patient record: to look at the
// X-ray in the room, or take a posture photo with the phone's camera.
//
// Read and written exactly as the web's Files tab (components/patients/
// FilesTab.vue): patient_files rows under the same RLS -- docs_files_scope
// decides whose files a role sees -- signed URLs from the 'patient-files'
// bucket, uploads to <account>/<patient>/<time>-<name>, and the same
// fire-and-forget compression pass afterwards.
import { sanitizeStorageFilename } from '../../utils/storageFilename'

const props = defineProps<{ patientId: string; accountId: string; teamMemberId: string }>()

const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()

interface FileRow {
  id: string
  file_name: string
  file_type: string | null
  storage_path: string | null
  created_at: string
}

const files = ref<FileRow[]>([])
const urls = ref<Record<string, string>>({})
const loading = ref(true)
const error = ref('')
const uploading = ref(false)
const uploadError = ref('')
const showAll = ref(false)
const lightbox = ref<FileRow | null>(null)

const PREVIEW_COUNT = 6
const shown = computed(() => (showAll.value ? files.value : files.value.slice(0, PREVIEW_COUNT)))

function isImage(f: FileRow) {
  return !!f.file_type?.startsWith('image/')
}
function isPdf(f: FileRow) {
  return f.file_type === 'application/pdf' || /\.pdf$/i.test(f.file_name)
}
function kindLabel(f: FileRow) {
  if (isPdf(f)) return 'PDF'
  const ext = f.file_name.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : t('FILE', 'ARCHIVO')
}
function shortName(f: FileRow) {
  return f.file_name.replace(/\.[^.]+$/, '')
}

async function load() {
  error.value = ''
  const { data, error: err } = await supabase
    .from('patient_files')
    .select('id, file_name, file_type, storage_path, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  if (err) {
    error.value = t('Could not load the files.', 'No se han podido cargar los archivos.')
    loading.value = false
    return
  }
  files.value = (data as FileRow[]) ?? []
  loading.value = false

  // One signing request for every image, as the web does, matched back by path.
  const images = files.value.filter((f) => f.storage_path && isImage(f))
  if (images.length === 0) return
  const { data: signed } = await supabase.storage.from('patient-files').createSignedUrls([...new Set(images.map((f) => f.storage_path!))], 60 * 10)
  const byPath: Record<string, string> = {}
  for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) byPath[s.path] = s.signedUrl
  const next: Record<string, string> = {}
  for (const f of images) if (byPath[f.storage_path!]) next[f.id] = byPath[f.storage_path!]
  urls.value = next
}
onMounted(load)

// An image opens over the record; anything else (a PDF report) goes to the
// system viewer, through openWhenReady -- the only way out of the app's
// WebView that works after an await (see utils/openWhenReady.ts).
function open(f: FileRow) {
  if (isImage(f) && urls.value[f.id]) {
    lightbox.value = f
    return
  }
  const path = f.storage_path
  if (!path) return
  openWhenReady(async () => {
    const { data } = await supabase.storage.from('patient-files').createSignedUrl(path, 60 * 5)
    return data?.signedUrl
  })
}

const cameraInput = ref<HTMLInputElement>()
async function onPhotoTaken(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  uploading.value = true
  // Snapshotted before the awaits, as the web does.
  const patientId = props.patientId
  try {
    // A camera capture arrives as "image.jpg" every time; the time keeps it
    // distinguishable in the list, as it does on the web.
    const name = file.name && file.name !== 'image.jpg' ? file.name : `${t('Photo', 'Foto')} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.jpg`
    const path = `${props.accountId}/${patientId}/${Date.now()}-${sanitizeStorageFilename(name)}`
    const { error: storageError } = await supabase.storage.from('patient-files').upload(path, file)
    if (storageError) {
      uploadError.value = storageError.message
      return
    }
    const { data: inserted, error: insertError } = await supabase
      .from('patient_files')
      .insert({
        account_id: props.accountId,
        patient_id: patientId,
        storage_path: path,
        file_name: name,
        file_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: props.teamMemberId,
      } as never)
      .select('id')
      .single()
    if (insertError) {
      // The row was refused, so the object would open to nothing: take it
      // back out rather than leave an orphan in the bucket.
      await supabase.storage.from('patient-files').remove([path])
      uploadError.value = insertError.message
      return
    }
    if (inserted) authedFetch('/api/patients/files/compress', { method: 'POST', body: { fileId: (inserted as { id: string }).id } }).catch(() => {})
    await load()
  } finally {
    uploading.value = false
    input.value = ''
  }
}
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card px-3.5 py-3" data-cy="patient-files">
    <div class="flex items-center justify-between">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Files', 'Archivos') }}</h2>
      <button v-if="files.length > PREVIEW_COUNT" type="button" class="text-[12.5px] font-medium text-brand-text" @click="showAll = !showAll">
        <template v-if="showAll">{{ t('Fewer', 'Menos') }}</template><template v-else>{{ t('All', 'Todos') }} {{ files.length }} <AppChevron :size="12" /></template>
      </button>
    </div>

    <div v-if="loading" class="mt-2 grid grid-cols-3 gap-1.5">
      <UiSkeleton v-for="i in 3" :key="i" class="aspect-square rounded-[9px]" />
    </div>
    <p v-else-if="error" class="mt-2 text-[13px] text-danger-text">{{ error }}</p>
    <template v-else>
      <p v-if="files.length === 0" class="mt-1.5 text-[13px] text-ink-faint">{{ t('No files yet.', 'Aún no hay archivos.') }}</p>
      <div v-else class="mt-2 grid grid-cols-3 gap-1.5">
        <button
          v-for="f in shown"
          :key="f.id"
          type="button"
          class="relative aspect-square overflow-hidden rounded-[9px] text-left"
          :class="isImage(f) && urls[f.id] ? 'bg-ink-900' : 'bg-surface-subtle'"
          :aria-label="f.file_name"
          data-cy="patient-file-tile"
          @click="open(f)"
        >
          <template v-if="isImage(f) && urls[f.id]">
            <img :src="urls[f.id]" :alt="f.file_name" class="h-full w-full object-cover" loading="lazy" />
            <span class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-semibold text-white">{{ shortName(f) }}</span>
          </template>
          <span v-else class="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1.5">
            <span class="text-[11.5px] font-bold text-ink-muted">{{ kindLabel(f) }}</span>
            <span class="w-full truncate text-center text-[10px] text-ink-faint">{{ shortName(f) }}</span>
          </span>
        </button>
      </div>

      <p v-if="uploadError" class="mt-2 text-[12.5px] text-danger-text">{{ uploadError }}</p>
      <label class="mt-2.5 flex h-10 items-center justify-center gap-1.5 rounded-card border border-line-control text-[13.5px] font-medium text-ink-700" :class="uploading ? 'opacity-60' : ''">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <path d="M2 5.5A1.5 1.5 0 013.5 4h1.6l1-1.5h3.8l1 1.5h1.6A1.5 1.5 0 0114 5.5v6A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5z" stroke-linejoin="round" />
          <circle cx="8" cy="8.3" r="2.3" />
        </svg>
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Add from camera', 'Añadir con la cámara') }}
        <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" :disabled="uploading" data-cy="patient-file-camera" @change="onPhotoTaken" />
      </label>
    </template>

    <Teleport to="body">
      <div v-if="lightbox" class="fixed inset-0 z-[60] flex flex-col bg-black/95" data-cy="patient-file-lightbox" @click="lightbox = null">
        <div class="flex items-center gap-3 px-3 py-2" style="padding-top: calc(env(safe-area-inset-top) + 8px)">
          <p class="min-w-0 flex-1 truncate text-[13.5px] font-medium text-white">{{ lightbox.file_name }}</p>
          <button type="button" class="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white" :aria-label="t('Close', 'Cerrar')" @click.stop="lightbox = null">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3l10 10M13 3 3 13" stroke-linecap="round" /></svg>
          </button>
        </div>
        <div class="flex min-h-0 flex-1 items-center justify-center p-3" style="padding-bottom: calc(env(safe-area-inset-bottom) + 12px)">
          <img :src="urls[lightbox.id]" :alt="lightbox.file_name" class="max-h-full max-w-full object-contain" @click.stop />
        </div>
      </div>
    </Teleport>
  </section>
</template>
