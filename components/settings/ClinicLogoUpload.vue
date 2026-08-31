<script setup lang="ts">
import { sanitizeStorageFilename } from '~/utils/storageFilename'

// Same upload-to-public-bucket pattern as PatientsPhotoUpload, minus the
// QR/phone flow (irrelevant here -- staff upload a clinic logo from the
// settings page they're already on, not from a phone camera).
const props = defineProps<{ clinicId: string; logoStoragePath: string | null }>()
const emit = defineEmits<{ uploaded: [] }>()

const supabase = useSupabaseClient()

const logoUrl = computed(() => {
  if (!props.logoStoragePath) return null
  return supabase.storage.from('clinic-logos').getPublicUrl(props.logoStoragePath).data.publicUrl
})

const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function pick() {
  fileInput.value?.click()
}

async function uploadFile(file: File) {
  uploading.value = true
  error.value = ''
  const path = `${useAccountStore().accountId}/${props.clinicId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
  const { error: uploadError } = await supabase.storage.from('clinic-logos').upload(path, file)
  if (uploadError) {
    error.value = uploadError.message
    uploading.value = false
    return
  }
  await supabase.from('clinics').update({ logo_storage_path: path }).eq('id', props.clinicId)
  uploading.value = false
  emit('uploaded')
}

function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) uploadFile(file)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="flex items-center gap-2">
    <div class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-surface-subtle" title="Shown on invoices and the online booking page">
      <img v-if="logoUrl" :src="logoUrl" class="h-full w-full object-contain" alt="Clinic logo" />
      <span v-else class="text-[9px] text-ink-faint">None</span>
    </div>
    <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover disabled:opacity-50" :disabled="uploading" @click="pick">
      {{ uploading ? '…' : logoUrl ? 'Replace' : 'Upload' }}
    </button>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
    <p v-if="error" class="text-[11px] text-danger-text">{{ error }}</p>
  </div>
</template>
