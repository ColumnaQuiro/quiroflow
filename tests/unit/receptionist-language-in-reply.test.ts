import { describe, expect, it, vi } from 'vitest'

// The language check and the held time inside a reply
// (server/utils/receptionistModel.ts), with the model faked.

vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist', () => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const { runReceptionistModel } = await import('../../server/utils/receptionistModel')

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

const says = (text: string): Turn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })

function run(turns: Turn[], inbound: string, over: Record<string, unknown> = {}) {
  const { client, seen } = fakeClient(turns)
  const promise = runReceptionistModel(client, {
    model: 'claude-haiku-5-5',
    maxTokens: 1000,
    system: { clinic: 'Clínica', role: 'Recepcionista', conversation: '' } as any,
    messages: [{ role: 'user', content: inbound }],
    internalNotes: [],
    logLabel: 'test',
    ...over,
  } as any)
  return { promise, seen }
}

describe('a reply in the wrong language', () => {
  it('with an English word in Spanish goes back once, and the Spanish one is sent', async () => {
    const right = '¿Cancelo también la del lunes 30 de noviembre a las 17:00?'
    const { promise, seen } = run([says('¿Also cancelo la del lunes 30 de noviembre a las 17:00?'), says(right)], 'Quiero cancelar mis dos citas, por favor')
    const result = await promise
    expect(result.text).toBe(right)
    expect(result.checks).toEqual(['english_words_rewritten'])
    expect(JSON.stringify(seen[1])).toContain('\\"Also\\"')
  })

  it('in English to someone writing in Spanish goes back once to be written in Spanish', async () => {
    const { promise, seen } = run([says('Your appointment is still on Tuesday 24 November at 11:30.'), says('Tu cita sigue el martes 24 de noviembre a las 11:30.')], 'Hola, ¿me confirmas la hora de mi cita?')
    const result = await promise
    expect(result.checks).toEqual(['language_rewritten'])
    expect(JSON.stringify(seen[1])).toContain('Rewrite your reply in Spanish')
  })

  it('goes as it is the second time, rather than leave them without an answer', async () => {
    const wrong = '¿Also cancelo la del lunes 30?'
    const { promise } = run([says(wrong), says(wrong)], 'Quiero cancelar mis dos citas, por favor')
    const result = await promise
    expect(result.refused).toBe(false)
    expect(result.text).toBe(wrong)
  })

  it('in their language is sent at once', async () => {
    const { promise } = run([says('Thanks, your visit stays on Monday 30 November at 17:00.')], 'Hi, can you tell me when my appointment is?')
    const result = await promise
    expect(result.checks).toEqual([])
  })
})

describe('a time they chose, held for them', () => {
  it('cannot be offered away: offer_times is refused while it is held', async () => {
    const offerTimes = vi.fn()
    const turns: Turn[] = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'offer_times', input: { times: [{ date: '2026-12-03', time: '18:00' }] } }] },
      says('Te guardo el miércoles 2 de diciembre a las 16:30. ¿Cómo se llama tu hija y cuál es su móvil?'),
    ]
    const { promise, seen } = run(turns, 'miércoles 2 · 16:30', { offerTimes: () => offerTimes, heldTime: { date: '2026-12-02', time: '16:30' } })
    const result = await promise
    expect(offerTimes).not.toHaveBeenCalled()
    expect(result.choices).toBeNull()
    expect(JSON.stringify(seen[1])).toContain('they already chose 2026-12-02 at 16:30')
  })
})
