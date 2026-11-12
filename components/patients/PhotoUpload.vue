<script setup lang="ts">
import QRCode from 'qrcode'
import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { shrinkImageForUpload } from '~/utils/imageShrink'
import { IMMUTABLE_CACHE_SECONDS } from '~/utils/storageCache'

const props = defineProps<{ patientId: string; photoStoragePath: string | null; initials: string }>()
const emit = defineEmits<{ uploaded: [] }>()

const supabase = useSupabaseClient()
const t = useT()

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

async function uploadFile(original: File) {
  uploading.value = true
  error.value = ''
  // Snapshotted once, up front: reading props.patientId again after the
  // storage upload's await, instead of this const, would risk writing the
  // photo onto whichever patient this component instance happens to be
  // showing by the time the upload resolves, not whoever it was picked for.
  const patientId = props.patientId
  const previous = props.photoStoragePath
  // Drawn as a small circle everywhere; stored as picked, it was whatever
  // the camera took. Same shrink a team photo gets.
  const file = await shrinkImageForUpload(original, 'photo')
  const path = `${useAccountStore().accountId}/${patientId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
  // The name carries the time, so this URL never serves different bytes: a
  // year in the browser and CDN cache instead of the default hour.
  const { error: uploadError } = await supabase.storage.from('patient-photos').upload(path, file, { cacheControl: IMMUTABLE_CACHE_SECONDS })
  if (uploadError) {
    error.value = `${t('The photo was not uploaded.', 'No se ha subido la foto.')} (${uploadError.message})`
    uploading.value = false
    return
  }
  const { data: saved, error: saveError } = await supabase.from('patients').update({ photo_storage_path: path }).eq('id', patientId).select('id')
  if (saveError || !saved?.length) {
    // Nothing points at the new file, so it must not stay behind.
    await supabase.storage.from('patient-photos').remove([path])
    error.value = `${t('The photo was not uploaded.', 'No se ha subido la foto.')}${saveError ? ` (${saveError.message})` : ''}`
    uploading.value = false
    return
  }
  // Each replacement used to leave the photo before it in the bucket for
  // good. Only once the new one is saved, and never the file just written.
  if (previous && previous !== path) await supabase.storage.from('patient-photos').remove([previous])
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
    error.value = e?.data?.statusMessage ?? t('Could not create the QR link.', 'No se pudo crear el enlace QR.')
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

// Modal dialogs on this screen: focus stays inside while open, Escape closes,
// focus returns to what opened it (useFocusTrap, following each v-if).
const qrTitleId = useId()
const qrPanel = ref<HTMLElement | null>(null)
useFocusTrap(qrPanel, closeQr, () => qrOpen.value)
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint text-[14px] font-semibold text-brand-text"
      :title="t('Change profile photo', 'Cambiar foto de perfil')"
      @click="openMenu"
    >
      <img v-if="photoUrl" :src="photoUrl" class="h-full w-full object-cover" alt="" />
      <span v-else>{{ initials }}</span>
      <span v-if="uploading" class="absolute inset-0 flex items-center justify-center bg-scrim/40 text-[11px] text-white">…</span>
    </button>

    <div v-if="menuOpen" class="absolute left-0 top-11 z-20 w-44 rounded-card border border-line bg-surface py-1 shadow-popover" @click.self="menuOpen = false">
      <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="pickFromComputer">
        {{ t('Upload from computer', 'Subir desde el ordenador') }}
      </button>
      <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="useYourPhone">
        {{ t('Use your phone (QR)', 'Usar tu móvil (QR)') }}
      </button>
    </div>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />

    <div v-if="qrOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/30 p-4" @click.self="closeQr">
      <div ref="qrPanel" role="dialog" aria-modal="true" :aria-labelledby="qrTitleId" class="max-h-full w-full overflow-y-auto max-w-xs rounded-card border border-line bg-surface p-6 text-center shadow-popover">
        <p :id="qrTitleId" class="text-[13.5px] font-[620] text-ink-900">{{ t('Scan with your phone', 'Escanea con tu móvil') }}</p>
        <p class="mt-1 text-[12px] text-ink-muted2">{{ t("Take a photo. It'll appear here by itself.", 'Haz una foto. Aparecerá aquí sola.') }}</p>
        <img :src="qrDataUrl" class="mx-auto mt-4 h-[220px] w-[220px]" :alt="t('QR code', 'Código QR')" />
        <UiBtn variant="secondary" class="mt-4 w-full justify-center" @click="closeQr">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </div>
    <p v-if="error" class="absolute left-0 top-11 z-20 w-48 text-[11px] text-danger-text">{{ error }}</p>
  </div>
</template>
