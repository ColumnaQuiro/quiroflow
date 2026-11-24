import type { PersonMask } from '../composables/usePoseModel'

// The person on white, for a posture photo: shared by the capture screen
// (components/posture/Capture.vue), which does it as each photo is taken,
// and by "Fondo blanco" on a saved assessment (components/posture/Whiten.vue),
// which does it afterwards to photos that were saved with the room behind
// them -- taken before this existed, or on a device that could not.
//
// Browser only: both draw on a canvas.

/** A canvas as the JPEG a posture photo is stored as. */
export const postureJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se ha podido leer la foto'))), 'image/jpeg', 0.86))

// The photo kept where the model's outline says it is the person, white
// everywhere else. The outline is soft (the model works at a lower
// resolution than the photo), so it is tightened a little -- below LOW is
// background, above HIGH is the person, a ramp between -- and then scaled up
// smoothly, which leaves an edge a pixel or two wide rather than a
// staircase. Only once cutoutVerdict (utils/posture.ts) believes the outline
// is one standing person.
const LOW = 0.35
const HIGH = 0.65
export function personOnWhite(photo: HTMLCanvasElement, mask: PersonMask): HTMLCanvasElement {
  const n = mask.width * mask.height
  const alpha = document.createElement('canvas')
  alpha.width = mask.width
  alpha.height = mask.height
  const actx = alpha.getContext('2d')!
  const img = actx.createImageData(mask.width, mask.height)
  for (let i = 0; i < n; i++) {
    const v = mask.data[i]!
    const t = Math.min(1, Math.max(0, (v - LOW) / (HIGH - LOW)))
    img.data[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255)
  }
  actx.putImageData(img, 0, 0)
  const out = document.createElement('canvas')
  out.width = photo.width
  out.height = photo.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(photo, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(alpha, 0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  return out
}
