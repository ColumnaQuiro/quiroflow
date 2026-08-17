<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

const files = ref<Tables<'patient_files'>[]>([])
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
  files.value = data ?? []
  loading.value = false
}
onMounted(load)

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
  const { data } = await supabase.storage.from('patient-files').createSignedUrl(file.storage_path, 60 * 5)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}

async function remove(file: Tables<'patient_files'>) {
  if (!confirm(`Delete ${file.file_name}?`)) return
  await supabase.storage.from('patient-files').remove([file.storage_path])
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
          <p class="text-sm font-medium text-gray-900">{{ file.file_name }}</p>
          <p class="text-xs text-gray-400">{{ formatSize(file.size_bytes) }} &middot; {{ new Date(file.created_at).toLocaleDateString() }}</p>
        </div>
        <div class="flex gap-3 text-sm">
          <button type="button" class="text-indigo-600 hover:text-indigo-700" @click="view(file)">View</button>
          <button type="button" class="text-red-600 hover:text-red-700" @click="remove(file)">Delete</button>
        </div>
      </li>
    </ul>
  </div>
</template>
