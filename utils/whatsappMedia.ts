// WhatsApp's Cloud API only accepts JPEG/PNG for image messages -- not
// HEIC/HEIF, which is the default photo format on iPhone (and therefore
// what the Inbox composer's file picker hands back on the exact platform
// this app mostly runs on). Sending a HEIC file straight through gets
// silently rejected by Meta with error 131053 "Media upload error".
//
// Beyond format, size matters too: the composer posts media as base64 JSON
// to a Netlify Function, and Netlify's function payload limit is 6MB --
// well under WhatsApp's own 16MB media cap. A camera shot or a picked PDF
// is normally small enough to clear that, but a full-resolution photo
// pulled from the gallery (many MB before base64's ~33% inflation) isn't,
// and blows past Netlify's limit before our own code ever runs -- which
// surfaces client-side as a generic "failed to send" with no server-side
// error to diagnose from, since the function was never invoked. Downscaling
// to a sane chat-photo size here (matching what WhatsApp's own app does to
// outgoing photos) fixes both problems in one pass: every image ends up a
// normal-format, transport-safe JPEG regardless of source format or size.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82
const SAFE_PASSTHROUGH_BYTES = 3 * 1024 * 1024

export async function normalizeImageForWhatsApp(file: File): Promise<{ blob: Blob; mimeType: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("This image format isn't supported -- try a JPEG or PNG."))
      el.src = url
    })
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
    // Already a small enough JPEG/PNG -- send as-is rather than lossily
    // re-encoding something that doesn't need it.
    if (scale === 1 && (file.type === 'image/jpeg' || file.type === 'image/png') && file.size < SAFE_PASSTHROUGH_BYTES) {
      return { blob: file, mimeType: file.type }
    }
    const width = Math.round(img.naturalWidth * scale)
    const height = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process this image.')
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
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
