// Shared by the internal send endpoint (Inbox composer, recall/confirmation
// sends), the public API (n8n etc.), and the inbound webhook's media
// handling -- one place for the Graph API calls instead of three copies.
interface WhatsAppAccount {
  whatsapp_phone_number_id: string
  whatsapp_access_token: string
}

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

// WhatsApp only allows free-form (non-template) messages within 24h of the
// customer's last inbound message; outside that window Meta rejects
// anything that isn't a pre-approved template.
export function isWithin24hWindow(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 60 * 60 * 1000
}

async function metaSend(account: WhatsAppAccount, payload: Record<string, unknown>): Promise<string | null> {
  const response = await $fetch<{ messages?: { id: string }[] }>(`${GRAPH_BASE}/${account.whatsapp_phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
    body: { messaging_product: 'whatsapp', ...payload },
  })
  return response.messages?.[0]?.id ?? null
}

export async function sendWhatsAppTemplate(
  account: WhatsAppAccount,
  to: string,
  templateName: string,
  templateLanguage: string,
  variables: string[],
  headerComponent?: Record<string, unknown>,
) {
  const components: Record<string, unknown>[] = []
  if (headerComponent) components.push(headerComponent)
  if (variables.length > 0) components.push({ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) })
  return metaSend(account, { to, type: 'template', template: { name: templateName, language: { code: templateLanguage }, components } })
}

export async function sendWhatsAppText(account: WhatsAppAccount, to: string, body: string) {
  return metaSend(account, { to, type: 'text', text: { body, preview_url: false } })
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

export async function sendWhatsAppMedia(
  account: WhatsAppAccount,
  to: string,
  mediaType: MediaKind,
  mediaId: string,
  opts?: { caption?: string; filename?: string },
) {
  const mediaObj: Record<string, unknown> = { id: mediaId }
  if (opts?.caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) mediaObj.caption = opts.caption
  if (opts?.filename && mediaType === 'document') mediaObj.filename = opts.filename
  return metaSend(account, { to, type: mediaType, [mediaType]: mediaObj })
}

// Uploads a local file to Meta so a send call can reference it by id --
// avoids needing to expose a public URL for outbound media.
export async function uploadMediaToMeta(account: WhatsAppAccount, fileBuffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename)
  const response = await $fetch<{ id: string }>(`${GRAPH_BASE}/${account.whatsapp_phone_number_id}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
    body: form,
  })
  return response.id
}

// Downloads inbound media: Meta's webhook only ever gives a media id, never
// the bytes, so this is a two-step resolve-url-then-fetch.
export async function downloadMetaMedia(account: WhatsAppAccount, mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const info = await $fetch<{ url: string; mime_type: string }>(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
  })
  const arrayBuffer = await $fetch<ArrayBuffer>(info.url, {
    headers: { Authorization: `Bearer ${account.whatsapp_access_token}` },
    responseType: 'arrayBuffer',
  })
  return { buffer: Buffer.from(arrayBuffer), mimeType: info.mime_type }
}

export function extensionForMimeType(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
    'application/pdf': 'pdf',
  }
  return map[mimeType] ?? mimeType.split('/')[1]?.split(';')[0] ?? 'bin'
}
