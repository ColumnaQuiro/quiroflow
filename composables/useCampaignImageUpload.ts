import { sanitizeStorageFilename } from '~/utils/storageFilename'
import { IMMUTABLE_CACHE_SECONDS } from '~/utils/storageCache'

// Images in emails go to the public "campaign-images" bucket, not
// patient-files: a mail client loads <img src> with no auth, so it cannot be
// a signed URL that expires. Shared by the rich-text editor and the email
// builder's image blocks.

export const MAX_CAMPAIGN_IMAGE_BYTES = 3 * 1024 * 1024

export function useCampaignImageUpload() {
  const supabase = useSupabaseClient()
  const store = useAccountStore()
  const t = useT()
  const uploading = ref(false)
  const error = ref('')

  /** The image's public URL, or null with `error` saying why not. */
  async function upload(file: File): Promise<string | null> {
    error.value = ''
    if (!file.type.startsWith('image/')) {
      error.value = t('Only image files can be inserted.', 'Solo se pueden insertar archivos de imagen.')
      return null
    }
    if (file.size > MAX_CAMPAIGN_IMAGE_BYTES) {
      error.value = `${t('Image is too large', 'La imagen es demasiado grande')} (max ${(MAX_CAMPAIGN_IMAGE_BYTES / (1024 * 1024)).toFixed(0)} MB).`
      return null
    }
    uploading.value = true
    try {
      const path = `${store.accountId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
      const { error: err } = await supabase.storage.from('campaign-images').upload(path, file, { cacheControl: IMMUTABLE_CACHE_SECONDS })
      if (err) {
        error.value = err.message
        return null
      }
      return supabase.storage.from('campaign-images').getPublicUrl(path).data.publicUrl
    } finally {
      uploading.value = false
    }
  }

  return { upload, uploading, error }
}
