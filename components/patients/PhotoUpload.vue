<script setup lang="ts">
import QRCode from 'qrcode'

const props = defineProps<{ patientId: string; photoStoragePath: string | null; initials: string }>()
const emit = defineEmits<{ uploaded: [] }>()

const supabase = useSupabaseClient()

const photoUrl = computed(() => {
  if (!props.photoStoragePath) return null
  return supabase.storage.from('patient-photos').getPublicUrl(props.photoStoragePath).data.publicUrl
})

const menuOpen = ref(false)
const qrOpen = ref(false)
const qrDataUrl = ref('')
const qrToken = ref('')
const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

function openMenu() {
  menuOpen.value = !menuOpen.value
}

function pickFromComputer() {
  menuOpen.value = false
  fileInput.value?.click()
}

async function uploadFile(file: File) {
  uploading.value = true
  error.value = ''
  const path = `${useAccountStore().accountId}/${props.patientId}/${Date.now()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from('patient-photos').upload(path, file)
  if (uploadError) {
    error.value = uploadError.message
    uploading.value = false
    return
  }
  await supabase.from('patients').update({ photo_storage_path: path }).eq('id', props.patientId)
  uploading.value = false
  emit('uploaded')
}

function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) uploadFile(file)
  ;(event.target as HTMLInputElement).value = ''
}

async function useYourPhone() {
  menuOpen.value = false
  error.value = ''
  try {
    const { token } = await useStaffFetch<{ token: string }>('/api/photo-upload/create-token', { method: 'POST', body: { patientId: props.patientId } })
    qrToken.value = token
    const url = `${window.location.origin}/photo-upload/${token}`
    qrDataUrl.value = await QRCode.toDataURL(url, { width: 220, margin: 1 })
    qrOpen.value = true
    startPolling()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Could not create the QR link.'
  }
}

// Bounded polling (only while the QR panel is open, token itself expires
// in 10 minutes server-side) rather than adding the patients table to
// Supabase Realtime just for this one occasional signal.
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    const { data } = await supabase.from('patients').select('photo_storage_path').eq('id', props.patientId).maybeSingle()
    if (data?.photo_storage_path && data.photo_storage_path !== props.photoStoragePath) {
      stopPolling()
      qrOpen.value = false
      emit('uploaded')
    }
  }, 2000)
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}
onUnmounted(stopPolling)
function closeQr() {
  qrOpen.value = false
  stopPolling()
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint text-[14px] font-semibold text-brand-text"
      title="Change profile photo"
      @click="openMenu"
    >
      <img v-if="photoUrl" :src="photoUrl" class="h-full w-full object-cover" alt="" />
      <span v-else>{{ initials }}</span>
      <span v-if="uploading" class="absolute inset-0 flex items-center justify-center bg-ink-900/40 text-[9px] text-white">…</span>
    </button>

    <div v-if="menuOpen" class="absolute left-0 top-11 z-20 w-44 rounded-card border border-line bg-surface py-1 shadow-popover" @click.self="menuOpen = false">
      <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="pickFromComputer">
        Upload from computer
      </button>
      <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="useYourPhone">
        Use your phone (QR)
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />

    <div v-if="qrOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/30 p-4" @click.self="closeQr">
      <div class="w-full max-w-xs rounded-card border border-line bg-surface p-6 text-center shadow-popover">
        <p class="text-[13.5px] font-[620] text-ink-900">Scan with your phone</p>
        <p class="mt-1 text-[12px] text-ink-muted2">Take a photo -- it'll appear here automatically.</p>
        <img :src="qrDataUrl" class="mx-auto mt-4 h-[220px] w-[220px]" alt="QR code" />
        <UiBtn variant="secondary" class="mt-4 w-full justify-center" @click="closeQr">Cancel</UiBtn>
      </div>
    </div>
    <p v-if="error" class="absolute left-0 top-11 z-20 w-48 text-[11px] text-danger-text">{{ error }}</p>
  </div>
</template>
