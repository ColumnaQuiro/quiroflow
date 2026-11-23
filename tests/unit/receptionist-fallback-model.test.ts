import { describe, expect, it, vi } from 'vitest'

vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist', () => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const { runReceptionistModel } = await import('../../server/utils/receptionistModel')

// A reply that comes back with nothing to send is tried once more on the
// default model before the person is passed to a colleague -- unless the
// first try already did something a second could do twice. And what the
// model writes around an offer or a booking is checked against the data.

type Turn = { stop_reason: string; content: unknown[] }

function fakeClient(turns: Turn[]) {
  const models: string[] = []
  const client = {
    messages: {
      create: vi.fn(async (params: { model: string }) => {
        models.push(params.model)
        const turn = turns.shift()
        if (!turn) throw new Error('no more turns')
        return { ...turn, usage: { input_tokens: 10, output_tokens: 5 } }
      }),
    },
  }
  return { client: client as any, models }
}

const says = (text: string): Turn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })
const calls = (name: string, input: unknown, words = ''): Turn => ({ stop_reason: 'tool_use', content: [...(words ? [{ type: 'text', text: words }] : []), { type: 'tool_use', id: `tu_${name}`, name, input }] })
const refusal: Turn = { stop_reason: 'refusal', content: [] }
const empty: Turn = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }] }

const base = {
  model: 'claude-haiku-5-5',
  fallbackModel: 'claude-sonnet-5',
  maxTokens: 1000,
  system: { clinic: 'Clínica', role: 'Recepcionista', conversation: '' } as any,
  messages: [{ role: 'user' as const, content: 'Hola' }],
  handOver: true,
  internalNotes: [],
  logLabel: 'test',
}
const BOOKED = { moved: false, typeName: 'Primera visita', slot: { date: '2026-12-02', time: '16:30' }, practitionerName: 'Marta Ríos', quiet: false, address: null, near: [], earlierOffer: false, repeatLateChange: false, forSomeoneElse: false }

describe('a reply with nothing to send', () => {
  it('is tried once more on the fallback model', async () => {
    const { client, models } = fakeClient([refusal, says('Abrimos de lunes a viernes.')])
    const run = await runReceptionistModel(client, base)
    expect(run.refused).toBe(false)
    expect(run.text).toBe('Abrimos de lunes a viernes.')
    expect(models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5'])
    expect(run.model).toBe('claude-sonnet-5')
    expect(run.checks).toEqual(['model_refused', 'retried_on_fallback_model'])
    expect(run.usage).toMatchObject({ rounds: 2, inputTokens: 20, outputTokens: 10 })
  })

  it('stays refused when the fallback has nothing either, or there is none', async () => {
    const both = fakeClient([refusal, refusal])
    expect((await runReceptionistModel(both.client, base)).refused).toBe(true)
    const none = fakeClient([refusal])
    expect((await runReceptionistModel(none.client, { ...base, fallbackModel: null })).refused).toBe(true)
    expect(none.models).toEqual(['claude-haiku-5-5'])
  })

  it('is not tried again after it cancelled a visit or handed over: a second try could do it twice', async () => {
    const cancelled = fakeClient([calls('cancel_appointment', { visit_on: '2026-12-02 16:30' }), refusal])
    const run = await runReceptionistModel(cancelled.client, { ...base, cancel: async () => ({ content: 'Cancelled.', isError: false }) })
    expect(run.refused).toBe(true)
    expect(cancelled.models).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])

    const handed = fakeClient([calls('hand_over_to_colleague', { reason: 'Pide hablar con la quiropráctica sobre su tratamiento.' }), refusal])
    expect((await runReceptionistModel(handed.client, base)).handedOver).toBeTruthy()
    expect(handed.models).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
  })

  it('keeps the first answer when the retry itself fails', async () => {
    const { client } = fakeClient([refusal])
    const run = await runReceptionistModel(client, base)
    expect(run.refused).toBe(true)
    expect(run.checks).toEqual(['model_refused'])
  })
})

describe('words around what it did', () => {
  const offerTimes = (onOffered: any) => async (input: any) => {
    onOffered(input.times, { slots: input.times.map((slot: any) => ({ ...slot, practitionerName: 'Marta Ríos' })), typeName: 'Primera visita', moveVisitOn: null, pinned: false, anyChiropractor: false, auto: true })
    return { content: 'The buttons will go under your reply.', isError: false }
  }
  const times = [{ date: '2026-12-02', time: '16:30' }, { date: '2026-12-09', time: '17:15' }]

  it('are written from the offer when the model names a time that is not under the reply', async () => {
    const { client } = fakeClient([calls('offer_times', { times }), says('Tengo el miércoles 2 a las 16:30 o el jueves 3 a las 19:00. ¿Cuál prefieres?')])
    const run = await runReceptionistModel(client, { ...base, offerTimes, maxTimesPerReply: 2 })
    expect(run.text).toBe('Tengo el miércoles 2 de diciembre a las 16:30 o el miércoles 9 de diciembre a las 17:15, con Marta. ¿Cuál te viene mejor?')
    expect(run.checks).toEqual(['offer_words_in_code'])
    expect(run.offer?.auto).toBe(true)
  })

  it('are the model\'s own when they offer those times, their visit named beside them', async () => {
    const text = 'Para cambiar tu cita de las 19:45 tengo el miércoles 2 de diciembre a las 16:30 o el miércoles 9 a las 17:15. ¿Cuál te viene mejor?'
    const { client } = fakeClient([calls('offer_times', { times }), says(text)])
    const run = await runReceptionistModel(client, { ...base, offerTimes, maxTimesPerReply: 2, standingTimes: new Set(['19:45']) })
    expect(run.text).toBe(text)
    expect(run.checks).toEqual([])
  })

  it('are a confirmation written from the booking when the model books and says nothing', async () => {
    const { client, models } = fakeClient([calls('book_appointment', { date: '2026-12-02', time: '16:30' }), empty])
    const run = await runReceptionistModel(client, { ...base, book: async () => ({ content: 'Booked.', isError: false, booked: BOOKED }) as any })
    expect(run.text).toBe('Reservado: Primera visita el miércoles 2 de diciembre a las 16:30, con Marta. Te llegará también la confirmación.')
    expect(run.checks).toEqual(['empty_confirmation_in_code'])
    expect(run.refused).toBe(false)
    expect(models).toHaveLength(2)
  })

  it('count a visit the code already booked as this reply\'s own', async () => {
    const { client } = fakeClient([says('Tu cita queda cambiada al miércoles 2 de diciembre a las 16:30. Es la segunda vez con poco aviso; intenta avisarnos antes cuando puedas.')])
    const run = await runReceptionistModel(client, { ...base, book: async () => ({ content: 'no', isError: true }), standingTimes: new Set(['9:30']), alreadyBooked: { input: { date: '2026-12-02', time: '16:30', move_visit_on: '2026-11-26 09:30' }, details: { ...BOOKED, moved: true, repeatLateChange: true } } })
    expect(run.refused).toBe(false)
    expect(run.checks).toEqual([])
    expect(run.toolUses).toEqual([{ name: 'book_appointment', input: { date: '2026-12-02', time: '16:30', move_visit_on: '2026-11-26 09:30' }, ok: true }])
  })
})
