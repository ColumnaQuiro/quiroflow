// The video or photo uploaded for a library exercise (exercises.media_path,
// bucket exercise-media; see the exercise_media_upload migration). Private,
// so it is shown through a short-lived signed URL; staff upload into their
// account's folder, and a patient can sign only the media of an exercise
// they were given.
export const EXERCISE_MEDIA_MAX_BYTES = 50 * 1024 * 1024
const BUCKET = 'exercise-media'
const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
const VIDEO_EXT = /\.(mp4|mov|webm)$/i

/** "video" or "image", from the stored path's extension. */
export function exerciseMediaKind(path: string): 'video' | 'image' {
  return VIDEO_EXT.test(path) ? 'video' : 'image'
}

export function useExerciseMedia() {
  const supabase = useSupabaseClient()
  const t = useT()

  /** Uploads into the account's folder. The path, or an error to show. */
  async function upload(accountId: string, file: File): Promise<{ path: string } | { error: string }> {
    if (!ACCEPTED.includes(file.type)) return { error: t('Choose a video (MP4, MOV) or a photo.', 'Elige un vídeo (MP4, MOV) o una foto.') }
    if (file.size > EXERCISE_MEDIA_MAX_BYTES) return { error: t('Up to 50 MB: about 30 seconds of video. Trim it and try again.', 'Hasta 50 MB: unos 30 segundos de vídeo. Recórtalo y vuelve a intentarlo.') }
    const ext = file.type === 'video/quicktime' ? 'mov' : file.type.split('/')[1].replace('jpeg', 'jpg')
    const path = `${accountId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) return { error: t("Couldn't upload it. Try again.", 'No se ha podido subir. Inténtalo de nuevo.') }
    return { path }
  }

  /** Best-effort: an object no exercise points at any more. */
  async function remove(path: string | null | undefined) {
    if (!path) return
    await supabase.storage.from(BUCKET).remove([path])
  }

  /** A URL good for an hour, or null when the caller may not see it. */
  async function signedUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl ?? null
  }

  return { upload, remove, signedUrl }
}
