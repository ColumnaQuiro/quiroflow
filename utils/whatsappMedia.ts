// WhatsApp's Cloud API only accepts JPEG/PNG for image messages -- not
// HEIC/HEIF, which is the default photo format on iPhone (and therefore
// what the Inbox composer's file picker hands back on the exact platform
// this app mostly runs on). Sending a HEIC file straight through gets
// silently rejected by Meta with error 131053 "Media upload error" --
// this is almost certainly why image sends were failing.
//
// Fixed by decoding via <img> + canvas and re-encoding as JPEG before
// upload, whenever the picked file isn't already jpeg/png. This relies on
// the browser being able to decode the source format into an <img> at all
// -- Safari/WKWebView (iOS) has native HEIC decode support, which covers
// the mobile app and iPhone Safari, the two places this actually needs to
// work. A desktop browser without HEIC decode support will fail here with
// a clear error instead of silently mis-sending, same tradeoff as voice
// notes on a browser whose MediaRecorder can't produce a WhatsApp-accepted
// format.
export async function normalizeImageForWhatsApp(file: File): Promise<{ blob: Blob; mimeType: string }> {
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    return { blob: file, mimeType: file.type }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("This image format isn't supported -- try a JPEG or PNG."))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process this image.')
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not process this image.')
    return { blob, mimeType: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
