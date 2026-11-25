import { describe, expect, it, vi } from 'vitest'

// The calendar is not read here: find_free_times is not offered.
vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist',() => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const { runReceptionistModel } = await import('../../server/utils/receptionistModel')

// 22 Nov 2026: Haiku called offer_times with two good times for a patient
// moving their visit, then ended the next turn with no words. Empty reads as
// refused, so the patient was handed to a person at 23:11 on a Sunday with a
// move the receptionist had already found.

type Turn = { stop_reason: string; content: unknown[] }

function fakeClient(turns: Turn[]) {
  const seen: unknown[][] = []
  const client = {
    messages: {
      create: vi.fn(async (params: { messages: unknown[] }) => {
        seen.push(JSON.parse(JSON.stringify(params.messages)))
        const turn = turns.shift()
        if (!turn) throw new Error('no more turns')
        return { ...turn, usage: { input_tokens: 1, output_tokens: 1 } }
      }),
    },
  }
  return { client: client as any, seen }
}

const OFFER = 'Para cambiar tu cita tengo el martes 1 de diciembre a las 19:15 o el jueves 3 de diciembre a las 18:30. ¿Cuál te viene mejor?'
const offerTurn = (words: string): Turn => ({
  stop_reason: 'tool_use',
  content: [
    ...(words ? [{ type: 'text', text: words }] : []),
    { type: 'tool_use', id: 'tu_1', name: 'offer_times', input: { times: [{ date: '2026-12-01', time: '19:15' }, { date: '2026-12-03', time: '18:30' }] } },
  ],
})
const empty: Turn = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }] }

function run(turns: Turn[]) {
  const { client, seen } = fakeClient(turns)
  const offered: unknown[] = []
  const promise = runReceptionistModel(client, {
    model: 'claude-haiku-5-5',
    maxTokens: 1000,
    system: { clinic: 'Clínica', role: 'Recepcionista', conversation: '' } as any,
    messages: [{ role: 'user', content: 'Podría ser la semana siguiente? El martes 1 a la misma hora, o el miércoles o el jueves a cualquier hora' }],
    handOver: true,
    offerTimes: (onOffered) => async (input: any) => {
      onOffered(input.times)
      offered.push(input.times)
      return { content: 'The buttons will go under your reply.', isError: false }
    },
    internalNotes: [],
    logLabel: 'test',
  })
  return { promise, seen, offered }
}

describe('a reply that comes back with no words', () => {
  it('is written from the times it offered, at once, without asking the model again', async () => {
    const { promise, seen } = run([offerTurn(''), empty])
    const result = await promise
    expect(result.refused).toBe(false)
    expect(result.text).toBe('Tengo el martes 1 de diciembre a las 19:15 o el jueves 3 de diciembre a las 18:30. ¿Cuál te viene mejor?')
    expect(result.checks).toEqual(['empty_offer_in_code'])
    expect(result.choices).toBe('times')
    expect(result.offeredSlots).toHaveLength(2)
    // Two requests: the one that offered, and the one that came back empty.
    expect(seen).toHaveLength(2)
  })

  it('uses the words written beside offer_times when they name those same times', async () => {
    const { promise } = run([offerTurn(OFFER), empty])
    const result = await promise
    expect(result.refused).toBe(false)
    expect(result.text).toBe(OFFER)
    expect(result.checks).toEqual(['empty_offer_words_used'])
    expect(result.choices).toBe('times')
  })

  it('is sent back once to be written when there is nothing to write it from', async () => {
    const { promise, seen } = run([empty, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Abrimos de lunes a viernes.' }] }])
    const result = await promise
    expect(result.text).toBe('Abrimos de lunes a viernes.')
    expect(result.checks).toContain('empty_rewritten')
    // The note rides on the last message of theirs: a turn of thinking alone is not repeated.
    const last = seen[1]!.at(-1) as { role: string; content: { type: string; text?: string }[] }
    expect(last.role).toBe('user')
    expect(last.content.some((block) => block.type === 'text' && /no text/.test(block.text ?? ''))).toBe(true)
  })

  it('is still handed over when there is nothing to send at all', async () => {
    const { promise } = run([empty, empty])
    const result = await promise
    expect(result.text).toBe('')
    expect(result.checks).toContain('empty_rewritten')
    expect(result.choices).toBeNull()
  })

  it('is not sent back when the model refused', async () => {
    const { promise } = run([{ stop_reason: 'refusal', content: [] }])
    const result = await promise
    expect(result.refused).toBe(true)
    expect(result.checks).toEqual(['model_refused'])
  })
})

// 25 Nov 2026: a lead's first message was answered at 00:37 with "Las dos
// opciones son:" and the times, and nothing else. What it wrote beside
// offer_times -- the greeting, the answer about their back -- was dropped,
// because only the last turn was sent.
describe('the words written beside offer_times', () => {
  const GREETING = 'Hola, gracias por escribirnos. Vemos a muchos pacientes con dolor de espalda y en la primera visita hacemos una valoración completa.'
  const TIMES = 'Las dos opciones son el martes 1 de diciembre a las 19:15 o el jueves 3 de diciembre a las 18:30. ¿Cuál prefieres?'
  const said = (text: string): Turn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })

  it('go in front of the reply that names the times', async () => {
    const { promise } = run([offerTurn(GREETING), said(TIMES)])
    const result = await promise
    expect(result.text).toBe(`${GREETING}\n\n${TIMES}`)
    expect(result.checks).toEqual(['offer_lead_kept'])
    expect(result.choices).toBe('times')
  })

  it('are not doubled when the reply already starts with them', async () => {
    const { promise } = run([offerTurn(GREETING), said(`${GREETING}\n\n${TIMES}`)])
    const result = await promise
    expect(result.text).toBe(`${GREETING}\n\n${TIMES}`)
    expect(result.checks).toEqual([])
  })

  it('tell the model they are sent, so it writes only what follows', async () => {
    const { promise, seen } = run([offerTurn(GREETING), said(TIMES)])
    await promise
    const results = seen[1]!.at(-1) as { role: string; content: { type: string; content?: string }[] }
    expect(results.content[0]!.content).toMatch(/sent as it is, in front of your reply/)
  })

  it('tell the model nothing when there were none', async () => {
    const { promise, seen } = run([offerTurn(''), said(TIMES)])
    const result = await promise
    expect(result.text).toBe(TIMES)
    const results = seen[1]!.at(-1) as { role: string; content: { type: string; content?: string }[] }
    expect(results.content[0]!.content).toBe('The buttons will go under your reply.')
  })

  it('go in front of the times written in code when the reply comes back empty', async () => {
    const { promise } = run([offerTurn(GREETING), empty])
    const result = await promise
    expect(result.text).toBe(`${GREETING}\n\nTengo el martes 1 de diciembre a las 19:15 o el jueves 3 de diciembre a las 18:30. ¿Cuál te viene mejor?`)
    expect(result.checks).toEqual(['empty_offer_in_code'])
  })
})
