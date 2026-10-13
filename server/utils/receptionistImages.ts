import type Anthropic from '@anthropic-ai/sdk'

// The pictures someone sent the AI receptionist, so it can see them.
//
// A lead wrote "Me aparece esto al intentar reservar cita" with a screenshot
// of a "page not found" -- and the receptionist, given only the text, replied
// as if the screenshot were not there. Images the person sent since the
// clinic last wrote go to the model with their message; older ones it already
// had its chance to see, and each costs tokens on every reply after.

const MAX_IMAGES = 3
// The API takes up to 5 MB per image, base64 encoded.
const MAX_BYTES = 3_700_000
const TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export interface StoredImage {
  direction: string
  media_type?: string | null
  media_storage_path?: string | null
  media_mime_type?: string | null
}

/**
 * The images among `sinceOurs` (oldest first) as content blocks, newest three
 * at most. Best-effort: one that cannot be read is left out, and the
 * conversation still says "[Image]" where it was.
 */
export async function recentImages(service: any, sinceOurs: StoredImage[]): Promise<Anthropic.ImageBlockParam[]> {
  const wanted = sinceOurs
    .filter((m) => m.direction === 'inbound' && m.media_type === 'image' && m.media_storage_path && TYPES.has((m.media_mime_type ?? '').toLowerCase()))
    .slice(-MAX_IMAGES)
  const blocks: Anthropic.ImageBlockParam[] = []
  for (const m of wanted) {
    try {
      const { data, error } = await service.storage.from('whatsapp-media').download(m.media_storage_path!)
      if (error || !data) continue
      const bytes = Buffer.from(await (data as Blob).arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: m.media_mime_type!.toLowerCase() as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: bytes.toString('base64') },
      })
    } catch (err) {
      console.warn('[receptionist] could not read an image for the model:', (err as Error)?.message ?? err)
    }
  }
  return blocks
}

/** The conversation with the images added to the last thing they said. */
export function withImages(messages: Anthropic.MessageParam[], images: Anthropic.ImageBlockParam[]): Anthropic.MessageParam[] {
  if (images.length === 0 || messages.length === 0) return messages
  const last = messages[messages.length - 1]!
  if (last.role !== 'user') return messages
  const text: Anthropic.ContentBlockParam[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content
  return [...messages.slice(0, -1), { role: 'user', content: [...images, ...text] }]
}
