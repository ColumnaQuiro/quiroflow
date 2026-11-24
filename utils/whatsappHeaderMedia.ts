// What a WhatsApp template header accepts -- the video on a welcome message,
// an image on an offer, a PDF guide -- shared by the automation step that
// uploads it and the server route that signs the upload, so the browser can
// refuse a file before sending it anywhere and the server refuses the same
// things if the browser is skipped.
//
// The list is Meta's, not our storage's: an .exe would upload perfectly
// well. It is about refusing at the door something that can only fail
// later, in front of a patient, as a template rejected mid-drip. A phone's
// .mov (video/quicktime) is the one clinics hit most.
//
// Pure, with no `~` imports: the app auto-imports this directory too.

export const WHATSAPP_HEADER_MEDIA_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  document: ['application/pdf'],
}

/**
 * Under WhatsApp's own 16 MB media cap, with room to spare. The file goes
 * straight from the browser to Storage, so this is the only size limit that
 * applies: it no longer passes through a Netlify function, whose ~6 MB
 * request limit used to refuse anything bigger before our code ran.
 */
export const WHATSAPP_HEADER_MEDIA_MAX_BYTES = 15 * 1024 * 1024

export type WhatsAppHeaderMediaProblem = 'kind' | 'too_large' | 'type' | null

/** Why a file cannot be a `kind` header, or null when it can. */
export function whatsappHeaderMediaProblem(kind: string, contentType: string, bytes: number): WhatsAppHeaderMediaProblem {
  const allowed = WHATSAPP_HEADER_MEDIA_TYPES[kind]
  if (!allowed) return 'kind'
  if (!(bytes > 0) || bytes > WHATSAPP_HEADER_MEDIA_MAX_BYTES) return 'too_large'
  if (!allowed.includes(contentType)) return 'type'
  return null
}

/** A filename safe to put in a storage path: lower case, dashes, at most 80 characters. */
export function whatsappHeaderMediaSafeName(filename: string): string {
  return (
    (filename || 'header')
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-80) || 'header'
  )
}
