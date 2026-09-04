<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { sanitizeStorageFilename } from '~/utils/storageFilename'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

// `visibility` isn't in the generated Supabase types yet -- merge it in
// locally rather than editing the generated file by hand.
type PatientFile = Tables<'patient_files'> & { visibility: 'generic' | 'custom' }

const files = ref<PatientFile[]>([])
const thumbUrls = ref<Record<string, string>>({})
const loading = ref(true)
const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement>()

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('patient_files')
    .select('*')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  files.value = (data as unknown as PatientFile[]) ?? []
  loading.value = false

  const images = files.value.filter((f) => f.file_type?.startsWith('image/') && f.storage_path)
  const urls: Record<string, string> = {}
  await Promise.all(
    images.map(async (f) => {
      const { data: signed } = await supabase.storage.from('patient-files').createSignedUrl(f.storage_path!, 60 * 10)
      if (signed?.signedUrl) urls[f.id] = signed.signedUrl
    }),
  )
  thumbUrls.value = urls
}
onMounted(load)

async function updateVisibility(file: PatientFile) {
  await supabase.from('patient_files').update({ visibility: file.visibility }).eq('id', file.id)
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function kindLabel(file: PatientFile) {
  const ext = file.file_name.split('.').pop()?.toUpperCase()
  if (ext && ext.length <= 5) return ext
  const type = file.file_type ?? ''
  if (type.startsWith('image/')) return 'IMG'
  if (type === 'application/pdf') return 'PDF'
  return 'FILE'
}

async function uploadFiles(fileList: FileList) {
  error.value = ''
  uploading.value = true
  for (const file of Array.from(fileList)) {
    const path = `${store.accountId}/${props.patientId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
    const { error: uploadError } = await supabase.storage.from('patient-files').upload(path, file)
    if (uploadError) {
      error.value = uploadError.message
      continue
    }
    const { data: inserted } = await supabase
      .from('patient_files')
      .insert({
        account_id: store.accountId!,
        patient_id: props.patientId,
        storage_path: path,
        file_name: file.name,
        file_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: store.teamMember?.id ?? null,
      })
      .select('id')
      .single()
    // Fire-and-forget: the upload itself already succeeded and is visible
    // below, so there's no reason to make the user wait on a background
    // optimization pass. A failure here (network hiccup, an unsupported
    // format) just leaves the file at its original size -- never blocks or
    // breaks the upload.
    if (inserted) useStaffFetch('/api/patients/files/compress', { method: 'POST', body: { fileId: inserted.id } }).catch(() => {})
  }
  uploading.value = false
  if (fileInput.value) fileInput.value.value = ''
  await load()
}

async function view(file: Tables<'patient_files'>) {
  if (!file.storage_path) return
  const { data } = await supabase.storage.from('patient-files').createSignedUrl(file.storage_path, 60 * 5)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}

async function remove(file: Tables<'patient_files'>) {
  if (!confirm(`${t('Delete', 'Eliminar')} ${file.file_name}?`)) return
  if (file.storage_path) await supabase.storage.from('patient-files').remove([file.storage_path])
  await supabase.from('patient_files').delete().eq('id', file.id)
  files.value = files.value.filter((f) => f.id !== file.id)
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Files', 'Archivos') }}</p>
      <label class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Upload file', 'Subir archivo') }}
        <input ref="fileInput" type="file" multiple class="hidden" :disabled="uploading" @change="(e) => uploadFiles((e.target as HTMLInputElement).files!)" />
      </label>
    </div>
    <p v-if="error" class="px-4 pt-3 text-[13px] text-danger-text">{{ error }}</p>

    <div v-if="loading" class="grid grid-cols-4 gap-4 p-4">
      <div v-for="i in 4" :key="i" class="overflow-hidden rounded-ctl border border-line-divider bg-surface">
        <UiSkeleton class="h-[104px] w-full rounded-none" />
        <div class="space-y-1.5 p-2.5">
          <UiSkeleton class="h-3 w-full rounded-ctlSm" />
          <UiSkeleton class="h-2.5 w-2/3 rounded-ctlSm" />
        </div>
      </div>
    </div>
    <div v-else-if="files.length === 0" class="p-8 text-center text-[13px] text-ink-faint">{{ t('No files uploaded yet.', 'Aún no se han subido archivos.') }}</div>
    <div v-else class="grid grid-cols-4 gap-4 p-4">
      <div v-for="file in files" :key="file.id" class="group overflow-hidden rounded-ctl border border-line-divider bg-surface">
        <div
          class="relative flex h-[104px] w-full items-center justify-center"
          :style="
            thumbUrls[file.id]
              ? { backgroundImage: `url(${thumbUrls[file.id]})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { backgroundImage: 'repeating-linear-gradient(135deg, #F4F5F8 0px, #F4F5F8 6px, #EDEEF2 6px, #EDEEF2 12px)' }
          "
        >
          <span v-if="!thumbUrls[file.id]" class="rounded-ctlSm bg-surface/90 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-muted2">
            {{ kindLabel(file) }}
          </span>
          <span v-if="!file.storage_path" class="absolute right-1.5 top-1.5 rounded-pill bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning-text">
            {{ t('Not migrated', 'No migrado') }}
          </span>
        </div>
        <div class="p-2.5">
          <p class="truncate text-[12px] font-medium text-ink-700" :title="file.file_name">{{ file.file_name }}</p>
          <p class="mt-0.5 text-[11px] text-ink-faint">{{ formatSize(file.size_bytes) }} &middot; {{ new Date(file.created_at).toLocaleDateString() }}</p>
          <div class="mt-1.5 flex items-center justify-between gap-1.5">
            <select
              v-model="file.visibility"
              class="min-w-0 rounded border border-line-control px-1 py-0.5 text-[10.5px] text-ink-muted focus:border-brand focus:outline-none"
              :title="t('Whether this file will show to the patient in the mobile app', 'Si este archivo se mostrará al paciente en la aplicación móvil')"
              @change="updateVisibility(file)"
            >
              <option value="generic">{{ t('Generic', 'Genérico') }}</option>
              <option value="custom">{{ t('Custom', 'Personalizado') }}</option>
            </select>
            <div class="flex shrink-0 items-center gap-2">
              <button v-if="file.storage_path" type="button" class="text-[11px] font-medium text-brand-text hover:text-brand-hover" @click="view(file)">{{ t('View', 'Ver') }}</button>
              <button type="button" class="text-[11px] font-medium text-danger-text hover:text-danger-text/80" @click="remove(file)">{{ t('Delete', 'Eliminar') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
