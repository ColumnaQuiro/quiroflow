// The clinic's own media on an education article, bucket learn-media (see
// the learn_library_for_patients and learn_articles_rich_content
// migrations): its video (learn_articles.media_path), its cover
// (cover_path) and the images in its text (image blocks). Private, shown
// through short-lived signed URLs; staff upload into their account's
// folder, and a patient can sign only what an article they can see uses
// (learn_articles.asset_paths). Exercise clips are useExerciseMedia: a
// different bucket, a quarter the size.
export const LEARN_MEDIA_MAX_BYTES = 200 * 1024 * 1024
export const LEARN_IMAGE_MAX_BYTES = 20 * 1024 * 1024
const BUCKET = 'learn-media'
const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/webm']
const ACCEPTED_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Wider than any phone or the reading column needs at 2x.
const IMAGE_MAX_SIDE = 1600

/**
 * A photo straight off a phone is 4-12 MB; the article shows it at most
 * ~700 px wide. Drawn down to IMAGE_MAX_SIDE as JPEG -- PNG kept as PNG
 * when it may be a screenshot with transparency, a GIF left alone so it
 * still moves. Whatever cannot be decoded here goes up as it is.
 */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 600 * 1024) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

export function useLearnMedia() {
  const supabase = useSupabaseClient()
  const t = useT()

  /** Uploads a video into the account's folder. The path, or an error to show. */
  async function upload(accountId: string, file: File): Promise<{ path: string } | { error: string }> {
    if (!ACCEPTED.includes(file.type)) return { error: t('Choose a video (MP4 or MOV).', 'Elige un vídeo (MP4 o MOV).') }
    if (file.size > LEARN_MEDIA_MAX_BYTES) return { error: t('Up to 200 MB: about two minutes of video. Trim it or record at 720p.', 'Hasta 200 MB: unos dos minutos de vídeo. Recórtalo o grábalo en 720p.') }
    const ext = file.type === 'video/quicktime' ? 'mov' : file.type.split('/')[1]
    const path = `${accountId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) return { error: t("Couldn't upload it. Try again.", 'No se ha podido subir. Inténtalo de nuevo.') }
    return { path }
  }

  /** Uploads an image (a cover, or one in the text), made web-sized first. */
  async function uploadImage(accountId: string, file: File): Promise<{ path: string } | { error: string }> {
    if (!ACCEPTED_IMAGES.includes(file.type)) return { error: t('Choose an image (JPG, PNG, WebP or GIF).', 'Elige una imagen (JPG, PNG, WebP o GIF).') }
    if (file.size > LEARN_IMAGE_MAX_BYTES) return { error: t('Up to 20 MB per image.', 'Hasta 20 MB por imagen.') }
    const blob = await shrinkImage(file)
    const type = blob.type || file.type
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]
    const path = `${accountId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false })
    if (error) return { error: t("Couldn't upload it. Try again.", 'No se ha podido subir. Inténtalo de nuevo.') }
    return { path }
  }

  /** Best-effort: media no article points at any more. */
  async function remove(paths: string | null | undefined | (string | null | undefined)[]) {
    const list = (Array.isArray(paths) ? paths : [paths]).filter((p): p is string => !!p)
    if (!list.length) return
    await supabase.storage.from(BUCKET).remove(list)
  }

  /** A URL good for an hour, or null when the caller may not see it. */
  async function signedUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  }

  /** Several at once, as path → URL; a path the caller may not see is left out. */
  async function signedUrls(paths: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(paths.filter(Boolean))]
    if (!unique.length) return {}
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 3600)
    const out: Record<string, string> = {}
    for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) out[r.path] = r.signedUrl
    return out
  }

  return { upload, uploadImage, remove, signedUrl, signedUrls }
}
