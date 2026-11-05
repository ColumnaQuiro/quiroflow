// The clinic's own video on an education article (learn_articles.media_path,
// bucket learn-media; see the learn_library_for_patients migration). Private,
// shown through a short-lived signed URL; staff upload into their account's
// folder, and a patient can sign only the video of an article they can see.
// Exercise clips are useExerciseMedia: a different bucket, a quarter the size.
export const LEARN_MEDIA_MAX_BYTES = 200 * 1024 * 1024
const BUCKET = 'learn-media'
const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/webm']

export function useLearnMedia() {
  const supabase = useSupabaseClient()
  const t = useT()

  /** Uploads into the account's folder. The path, or an error to show. */
  async function upload(accountId: string, file: File): Promise<{ path: string } | { error: string }> {
    if (!ACCEPTED.includes(file.type)) return { error: t('Choose a video (MP4 or MOV).', 'Elige un vídeo (MP4 o MOV).') }
    if (file.size > LEARN_MEDIA_MAX_BYTES) return { error: t('Up to 200 MB: about two minutes of video. Trim it or record at 720p.', 'Hasta 200 MB: unos dos minutos de vídeo. Recórtalo o grábalo en 720p.') }
    const ext = file.type === 'video/quicktime' ? 'mov' : file.type.split('/')[1]
    const path = `${accountId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) return { error: t("Couldn't upload it. Try again.", 'No se ha podido subir. Inténtalo de nuevo.') }
    return { path }
  }

  /** Best-effort: a video no article points at any more. */
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
