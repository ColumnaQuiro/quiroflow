<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

// `visibility` isn't in the generated Supabase types yet -- merge it in
// locally rather than editing the generated file by hand.
type PatientFile = Tables<'patient_files'> & { visibility: 'generic' | 'custom' }

const files = ref<PatientFile[]>([])
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

async function uploadFiles(fileList: FileList) {
  error.value = ''
  uploading.value = true
  for (const file of Array.from(fileList)) {
    const path = `${store.accountId}/${props.patientId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('patient-files').upload(path, file)
    if (uploadError) {
      error.value = uploadError.message
      continue
    }
    await supabase.from('patient_files').insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      storage_path: path,
      file_name: file.name,
      file_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: store.teamMember?.id ?? null,
    })
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
  if (!confirm(`Delete ${file.file_name}?`)) return
  if (file.storage_path) await supabase.storage.from('patient-files').remove([file.storage_path])
  await supabase.from('patient_files').delete().eq('id', file.id)
  files.value = files.value.filter((f) => f.id !== file.id)
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <div class="flex items-center justify-between border-b border-gray-100 p-4">
      <h3 class="text-sm font-semibold text-gray-900">Files</h3>
      <label class="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
        {{ uploading ? 'Uploading…' : 'Upload file' }}
        <input ref="fileInput" type="file" multiple class="hidden" :disabled="uploading" @change="(e) => uploadFiles((e.target as HTMLInputElement).files!)" />
      </label>
    </div>
    <p v-if="error" class="px-4 pt-3 text-sm text-red-600">{{ error }}</p>

    <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="files.length === 0" class="p-8 text-center text-sm text-gray-400">No files uploaded yet.</div>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="file in files" :key="file.id" class="flex items-center justify-between px-4 py-3">
        <div>
          <p class="text-sm font-medium text-gray-900">
            {{ file.file_name }}
            <span v-if="!file.storage_path" class="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
              Not migrated yet
            </span>
          </p>
          <p class="text-xs text-gray-400">{{ formatSize(file.size_bytes) }} &middot; {{ new Date(file.created_at).toLocaleDateString() }}</p>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <select
            v-model="file.visibility"
            class="rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            title="Whether this file will show to the patient in the mobile app"
            @change="updateVisibility(file)"
          >
            <option value="generic">Generic</option>
            <option value="custom">Custom</option>
          </select>
          <button v-if="file.storage_path" type="button" class="text-indigo-600 hover:text-indigo-700" @click="view(file)">View</button>
          <button type="button" class="text-red-600 hover:text-red-700" @click="remove(file)">Delete</button>
        </div>
      </li>
    </ul>
  </div>
</template>
