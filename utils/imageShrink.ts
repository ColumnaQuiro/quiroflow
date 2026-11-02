// Clinic logos and team photos used to be stored exactly as uploaded, and
// every surface that shows one carries the whole file: an 820 KB logo went
// into every invoice and factura PDF, every automation email and every
// wallet pass, for an image the PDFs draw at most 120x60 points.
//
// Formats are chosen by what reads them, not by what is smallest:
// - Logos stay JPEG or PNG. pdfkit (invoiceData, facturaData...) decodes
//   nothing else, Apple's pass only embeds a PNG, and Google Wallet's
//   logoUrl is only offered for a .png/.jpg path (walletPass.ts). A PNG
//   stays PNG -- logos are mostly flat colour and text, which JPEG smears,
//   and a transparent one has to stay transparent on a coloured header.
// - Photos are JPEG. They are only ever drawn by browsers, but Safari's
//   canvas cannot encode WebP (toBlob quietly hands back a PNG instead), and
//   older iOS web views cannot show one.
//
// Relative imports only: the mobile bundle renders TeamMemberPhotoUpload,
// and there ~ means mobile/.

export type ImageShrinkKind = 'logo' | 'photo'

// Logo: long side, which at 120 pt across is ~360 dpi printed. Photo: SHORT
// side, because every place draws it as an object-cover circle, which shows
// a square the size of the short side (64 px at most, so 256 covers a 3x
// screen with room to spare).
const LOGO_MAX_LONG_SIDE = 600
const PHOTO_MAX_SHORT_SIDE = 256
const JPEG_QUALITY = 0.85

export interface ImageShrinkPlan {
  width: number
  height: number
  type: 'image/jpeg' | 'image/png'
}

/**
 * The size and format an image of this shape is re-encoded to. Never
 * upscales a bitmap. An SVG is drawn at the cap instead of its nominal size,
 * which is often a few dozen pixels -- and nothing downstream can read the
 * SVG itself, pdfkit included.
 */
export function planImageShrink(kind: ImageShrinkKind, width: number, height: number, sourceType: string, hasAlpha: boolean): ImageShrinkPlan {
  const fit = kind === 'logo' ? LOGO_MAX_LONG_SIDE / Math.max(width, height) : PHOTO_MAX_SHORT_SIDE / Math.min(width, height)
  const scale = sourceType === 'image/svg+xml' ? fit : Math.min(1, fit)
  const type = kind === 'logo' && (sourceType === 'image/png' || hasAlpha) ? 'image/png' : 'image/jpeg'
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), type }
}

/** `logo.HEIC` -> `logo.jpg`, so the stored path names what is in it. */
export function renameForImageType(name: string, type: ImageShrinkPlan['type']): string {
  const base = name.replace(/\.[^./]*$/, '') || 'image'
  return `${base}.${type === 'image/png' ? 'png' : 'jpg'}`
}

/**
 * A smaller copy of `file` for upload, or `file` itself when the browser
 * cannot decode it (an SVG with no size, HEIC outside Safari) or re-encoding
 * would not make it smaller. In those cases the upload behaves as it always
 * did, rather than being refused.
 */
export async function shrinkImageForUpload(file: File, kind: ImageShrinkKind): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    // drawImage applies the EXIF orientation, so a phone photo comes out
    // upright rather than as the sensor saw it.
    const { naturalWidth: w, naturalHeight: h } = img
    if (!w || !h) return file

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return file
    canvas.width = w
    canvas.height = h
    // Only a logo can come out as PNG, so only a logo needs the alpha scan.
    let hasAlpha = false
    if (kind === 'logo' && file.type !== 'image/jpeg') {
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h).data
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          hasAlpha = true
          break
        }
      }
    }

    const plan = planImageShrink(kind, w, h, file.type, hasAlpha)
    canvas.width = plan.width
    canvas.height = plan.height
    ctx.imageSmoothingQuality = 'high'
    // JPEG has no alpha; without a fill a transparent area turns black.
    if (plan.type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, plan.width, plan.height)
    }
    ctx.drawImage(img, 0, 0, plan.width, plan.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.type, JPEG_QUALITY))
    // A browser that cannot encode the type returns some other one; storing
    // that under a .jpg name would mislead walletPass's type checks.
    if (!blob || blob.type !== plan.type) return file
    if (blob.size >= file.size && (file.type === 'image/jpeg' || file.type === 'image/png') && plan.width === w && plan.height === h) return file
    return new File([blob], renameForImageType(file.name, plan.type), { type: plan.type })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
