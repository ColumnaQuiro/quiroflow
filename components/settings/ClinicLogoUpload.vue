<script setup lang="ts">
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
  const path = `${useAccountStore().accountId}/${props.clinicId}/${Date.now()}-${file.name}`
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
  <div class="flex items-center gap-3">
    <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-surface-subtle">
      <img v-if="logoUrl" :src="logoUrl" class="h-full w-full object-contain" alt="Clinic logo" />
      <span v-else class="text-[10px] text-ink-faint">No logo</span>
    </div>
    <div>
      <UiBtn variant="secondary" size="sm" :disabled="uploading" @click="pick">{{ uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo' }}</UiBtn>
      <p class="mt-1 text-[11px] text-ink-faint">Shown at the top of every invoice for this clinic.</p>
      <p v-if="error" class="mt-1 text-[11px] text-danger-text">{{ error }}</p>
    </div>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
  </div>
</template>
