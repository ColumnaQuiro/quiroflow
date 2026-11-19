import { afterEach, describe, expect, it, vi } from 'vitest'
import { needsTranscript, tidyTranscript, transcribeVoiceNotes, type VoiceNoteRow } from '../../server/utils/voiceNoteTranscripts'
import { cleanReply, historyLine, historyMarkersSection, VOICE_NOTE_TRANSCRIPT_MARK } from '../../utils/receptionistHistory'

// The receptionist could not hear voice notes: one reached it as
// "[Voice note -- you cannot listen to it]", and a patient who asked for an
// appointment out loud was asked to write it instead.

/** A Supabase stand-in: Storage hands back `audio`, and every transcript written is kept. */
function fakeService(audio: Record<string, Uint8Array | null>) {
  const written: { id: string; transcript: string }[] = []
  return {
    written,
    storage: {
      from: () => ({
        download: async (path: string) => (audio[path] ? { data: new Blob([audio[path]!]), error: null } : { data: null, error: { message: 'not found' } }),
      }),
    },
    from: (table: string) => ({
      update: (values: { transcript: string }) => ({
        eq: (_col: string, id: string) => ({
          is: async () => {
            expect(table).toBe('whatsapp_messages')
            written.push({ id, transcript: values.transcript })
            return { error: null }
          },
        }),
      }),
    }),
  }
}

function voiceNote(id: string, extra: Partial<VoiceNoteRow> = {}): VoiceNoteRow {
  return { id, direction: 'inbound', media_type: 'audio', media_storage_path: `acc/${id}.ogg`, media_mime_type: 'audio/ogg', transcript: null, ...extra }
}

function mistralSays(texts: string[]) {
  const calls: { auth: string | null; model: unknown; file: unknown }[] = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const form = init.body as FormData
    calls.push({ auth: new Headers(init.headers).get('authorization'), model: form.get('model'), file: form.get('file') })
    return new Response(JSON.stringify({ text: texts[i++] ?? '' }), { status: 200 })
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('A voice note as the receptionist reads it', () => {
  it('reads a transcribed one as what they said', () => {
    const line = historyLine({ direction: 'inbound', body: null, mediaType: 'audio', transcript: 'Hola, quería pedir cita para el martes por la tarde' })
    expect(line).toBe(`${VOICE_NOTE_TRANSCRIPT_MARK}\nHola, quería pedir cita para el martes por la tarde`)
  })

  it('still says it could not listen when there is no transcript', () => {
    expect(historyLine({ direction: 'inbound', body: null, mediaType: 'audio', transcript: null })).toContain('you cannot listen to it')
    expect(historyLine({ direction: 'inbound', body: null, mediaType: 'audio', transcript: '   ' })).toContain('you cannot listen to it')
  })

  it('tells the model what the mark means, and to check what it may have misheard', () => {
    const section = historyMarkersSection(false)
    expect(section).toContain(VOICE_NOTE_TRANSCRIPT_MARK)
    expect(section).toMatch(/confirm/)
  })

  it('takes the mark off a reply that copied it', () => {
    expect(cleanReply(`${VOICE_NOTE_TRANSCRIPT_MARK}\nTe espero el martes a las 17:00`)).toBe('Te espero el martes a las 17:00')
  })
})

describe('Transcribing voice notes', () => {
  it('transcribes the ones without a transcript, fills them in and saves them', async () => {
    const calls = mistralSays(['  Hola,\n quería   pedir cita ', 'Mejor el jueves'])
    const service = fakeService({ 'acc/a.ogg': new Uint8Array([1, 2, 3]), 'acc/b.ogg': new Uint8Array([4, 5]) })
    const rows = [voiceNote('a'), { id: 'x', direction: 'outbound' } as VoiceNoteRow, voiceNote('b')]

    await transcribeVoiceNotes(service, rows, 'test-key')

    expect(calls).toHaveLength(2)
    expect(calls[0]!.auth).toBe('Bearer test-key')
    expect(calls[0]!.model).toBe('voxtral-mini-latest')
    expect(calls[0]!.file).toBeInstanceOf(Blob)
    expect(rows.map((r) => r.transcript ?? null)).toEqual(['Hola, quería pedir cita', null, 'Mejor el jueves'])
    expect(service.written).toEqual([
      { id: 'a', transcript: 'Hola, quería pedir cita' },
      { id: 'b', transcript: 'Mejor el jueves' },
    ])
  })

  it('does nothing without a key', async () => {
    const calls = mistralSays(['nunca'])
    const rows = [voiceNote('a')]
    await transcribeVoiceNotes(fakeService({ 'acc/a.ogg': new Uint8Array([1]) }), rows, '')
    expect(calls).toHaveLength(0)
    expect(rows[0]!.transcript).toBeNull()
  })

  it('never transcribes one twice, nor what the clinic sent', () => {
    expect(needsTranscript(voiceNote('a', { transcript: 'ya está' }))).toBe(false)
    expect(needsTranscript(voiceNote('a', { direction: 'outbound' }))).toBe(false)
    expect(needsTranscript(voiceNote('a', { media_type: 'image' }))).toBe(false)
    expect(needsTranscript(voiceNote('a', { media_storage_path: null }))).toBe(false)
    expect(needsTranscript(voiceNote('a'))).toBe(true)
  })

  it('only the newest three per draft', async () => {
    const calls = mistralSays(['3', '4', '5'])
    const audio = Object.fromEntries(['1', '2', '3', '4', '5'].map((id) => [`acc/${id}.ogg`, new Uint8Array([1])]))
    const rows = ['1', '2', '3', '4', '5'].map((id) => voiceNote(id))
    await transcribeVoiceNotes(fakeService(audio), rows, 'k')
    expect(calls).toHaveLength(3)
    expect(rows.map((r) => r.transcript)).toEqual([null, null, '3', '4', '5'])
  })

  it('leaves it untranscribed when Mistral refuses or the file is missing, without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"bad format"}', { status: 422 })))
    const service = fakeService({ 'acc/a.ogg': new Uint8Array([1]) })
    const rows = [voiceNote('a'), voiceNote('gone')]
    await expect(transcribeVoiceNotes(service, rows, 'k')).resolves.toBeUndefined()
    expect(rows.map((r) => r.transcript)).toEqual([null, null])
    expect(service.written).toEqual([])
  })

  it('cuts a very long one', () => {
    const out = tidyTranscript('palabra '.repeat(2000))
    expect(out.length).toBeLessThanOrEqual(4001)
    expect(out.endsWith('…')).toBe(true)
  })
})
