<script setup lang="ts">
import { sanitizeStorageFilename } from '../../utils/storageFilename'

// Same upload-to-public-bucket pattern as ClinicLogoUpload/PatientsPhotoUpload.
// `accountId` is taken as a prop rather than read from useAccountStore()
// internally so this same component works from the mobile bundle too
// (mobile doesn't register @pinia/nuxt -- see usePractitionerContext.ts).
const props = withDefaults(
  defineProps<{
    accountId: string
    teamMemberId: string
    photoStoragePath: string | null
    initials: string
    color?: string
    size?: number
  }>(),
  { color: '#4C6FEB', size: 32 },
)
// Failures are the parent's to show: the web has toasts, the mobile bundle
// does not, so this only reports them.
const emit = defineEmits<{ uploaded: []; failed: [message: string] }>()

const supabase = useSupabaseClient()

const photoUrl = computed(() => {
  if (!props.photoStoragePath) return null
  return supabase.storage.from('team-member-photos').getPublicUrl(props.photoStoragePath).data.publicUrl
})

const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function pick() {
  fileInput.value?.click()
}

async function uploadFile(file: File) {
  uploading.value = true
  const path = `${props.accountId}/${props.teamMemberId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
  const { error } = await supabase.storage.from('team-member-photos').upload(path, file)
  if (error) {
    uploading.value = false
    emit('failed', error.message)
    return
  }
  // The file is up; pointing the profile at it can still be refused.
  const { error: saveError } = await supabase.from('team_members').update({ photo_storage_path: path }).eq('id', props.teamMemberId).select('id').single()
  uploading.value = false
  if (saveError) {
    emit('failed', saveError.message)
    return
  }
  emit('uploaded')
}

function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) uploadFile(file)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <button
    type="button"
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white disabled:opacity-50"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(9, size * 0.32)}px`, backgroundColor: photoUrl ? undefined : color }"
    :disabled="uploading"
    title="Change photo"
    @click="pick"
  >
    <img v-if="photoUrl" :src="photoUrl" class="h-full w-full object-cover" alt="" />
    <span v-else>{{ uploading ? '…' : initials }}</span>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
  </button>
</template>
