// What a voice note said, so the AI receptionist can answer it.
//
// The model behind the receptionist takes text and images, not audio, so a
// voice note reached it as "[Voice note -- you cannot listen to it]" -- and a
// patient who asked for an appointment out loud was asked to write it
// instead. Each inbound voice note is transcribed by Mistral's Voxtral (an EU
// provider; see utils/legalSubprocessors.ts) the first time a draft reads the
// conversation, and the text is kept on the message (whatsapp_messages.
// transcript), so it is transcribed once rather than on every reply after.
//
// Plain fetch rather than Mistral's SDK: this file is under server/utils, and
// everything there is evaluated on every cold start (CLAUDE.md).
//
// Best-effort throughout. No key, a file that cannot be read, a slow or
// failed call: the voice note stays untranscribed, the conversation still
// says "[Voice note]" where it was, and the next draft tries again.

const ENDPOINT = 'https://api.mistral.ai/v1/audio/transcriptions'
const MODEL = 'voxtral-mini-latest'
// Per draft, newest first. A conversation's older voice notes get theirs on
// later drafts; three is more than anyone sends between two replies.
const MAX_PER_DRAFT = 3
// WhatsApp caps audio at 16 MB; a voice note is ~100 KB a minute.
const MAX_BYTES = 16_000_000
// A draft is waited on (the composer's "Draft with AI", the tick's send), so
// a transcription that hangs must not hold it up for long.
const TIMEOUT_MS = 20_000
// The transcript goes into the prompt on every reply after; a 20-minute
// monologue does not need to.
const MAX_CHARS = 4000

export interface VoiceNoteRow {
  id?: string | null
  direction: string
  media_type?: string | null
  media_storage_path?: string | null
  media_mime_type?: string | null
  transcript?: string | null
}

/** Whether this message is a voice note still waiting for its transcript. */
export function needsTranscript(m: VoiceNoteRow): boolean {
  return m.direction === 'inbound' && m.media_type === 'audio' && Boolean(m.id) && Boolean(m.media_storage_path) && !m.transcript?.trim()
}

/** The text as the model reads it: whitespace tidied, very long ones cut. */
export function tidyTranscript(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_CHARS ? `${flat.slice(0, MAX_CHARS).trimEnd()}…` : flat
}

/** One audio file to text via Voxtral; null when it heard nothing. Throws on a failed call. */
export async function transcribeAudio(apiKey: string, bytes: Uint8Array, mimeType: string, filename: string): Promise<string | null> {
  const form = new FormData()
  form.append('model', MODEL)
  form.append('stream', 'false')
  // No language: most voice notes are Spanish, but a clinic's foreign
  // patients write in theirs, and Voxtral detects it.
  form.append('file', new Blob([bytes], { type: mimeType }), filename)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    // The body names the reason (unsupported format, bad key) and holds no
    // audio, so it is safe to log.
    const detail = await res.text().catch(() => '')
    throw new Error(`Mistral ${res.status}: ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as { text?: unknown }
  const text = typeof json.text === 'string' ? tidyTranscript(json.text) : ''
  return text || null
}

function filenameFor(mimeType: string): string {
  const type = mimeType.split(';')[0]!.trim().toLowerCase()
  const ext = ({ 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/webm': 'webm' } as Record<string, string>)[type] ?? 'ogg'
  return `voice-note.${ext}`
}

/**
 * Fills `transcript` on the voice notes among `rows` (oldest first) that have
 * none yet -- in place, so the caller's history reads them -- and saves each
 * to its message. The newest MAX_PER_DRAFT at most.
 */
export async function transcribeVoiceNotes(service: any, rows: VoiceNoteRow[], apiKey: string | undefined | null): Promise<void> {
  if (!apiKey) return
  const wanted = rows.filter(needsTranscript).slice(-MAX_PER_DRAFT)
  // In parallel: each is a separate download and call, and the draft waits
  // for the slowest rather than the sum.
  await Promise.all(
    wanted.map(async (m) => {
      try {
        const { data, error } = await service.storage.from('whatsapp-media').download(m.media_storage_path!)
        if (error || !data) return
        const bytes = new Uint8Array(await (data as Blob).arrayBuffer())
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return
        const mimeType = (m.media_mime_type || 'audio/ogg').toLowerCase()
        const text = await transcribeAudio(apiKey, bytes, mimeType, filenameFor(mimeType))
        if (!text) return
        m.transcript = text
        // Only where it is still empty: two drafts racing on one voice note
        // write much the same thing, but one already there is never replaced.
        await service.from('whatsapp_messages').update({ transcript: text }).eq('id', m.id).is('transcript', null)
      } catch (err) {
        console.warn('[receptionist] could not transcribe a voice note:', (err as Error)?.message ?? err)
      }
    }),
  )
}
