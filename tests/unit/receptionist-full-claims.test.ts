import { describe, expect, it, vi } from 'vitest'
import { contradictingTimes, fullClaimNote, noFreeTimeClaim, type FreeTimesSource } from '../../utils/receptionistFullClaims'

vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist', () => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const { runReceptionistModel } = await import('../../server/utils/receptionistModel')

// 24 Nov 2026, 20:50 (Tuesday): a patient asked for mornings and the
// receptionist answered "Por la mañana no tenemos huecos en las próximas dos
// semanas", then "ningún hueco antes del martes 15 de diciembre". Thursday
// 26 Nov at 12:00 was free -- in the very list the prompt gave her.

const TODAY = '2026-11-24'

/** The prompt's list that evening, cut down: one morning time, the rest afternoons. */
const prompt: FreeTimesSource = {
  from: TODAY,
  to: '2026-12-07',
  groups: [
    { days: [{ date: '2026-11-25', times: ['17:15'] }, { date: '2026-11-26', times: ['12:00', '15:45', '17:30'] }, { date: '2026-12-02', times: ['17:15'] }], truncatedAfter: null },
  ],
}

describe('noFreeTimeClaim', () => {
  it('reads the claims of 24 Nov with their dates and part of the day', () => {
    expect(noFreeTimeClaim('Por la mañana no tenemos huecos en las próximas dos semanas. ¿Te iría bien por la tarde?', TODAY)).toEqual({
      sentence: 'Por la mañana no tenemos huecos en las próximas dos semanas.',
      part: 'morning',
      from: TODAY,
      to: '2026-12-07',
    })
    expect(noFreeTimeClaim('Hasta el 14 de diciembre no tenemos huecos por la mañana. Los primeros que encuentro son…', TODAY)).toMatchObject({ part: 'morning', from: TODAY, to: '2026-12-14' })
    expect(noFreeTimeClaim('Por la mañana no tenemos ningún hueco antes del martes 15 de diciembre.', TODAY)).toMatchObject({ to: '2026-12-14' })
  })

  it('reads a single day, and the weeks people name', () => {
    expect(noFreeTimeClaim('Lo siento, el lunes 30 de noviembre no tenemos ningún hueco libre.', TODAY)).toMatchObject({ part: null, from: '2026-11-30', to: '2026-11-30' })
    expect(noFreeTimeClaim('La semana que viene no me queda nada por la tarde.', TODAY)).toMatchObject({ part: 'afternoon', from: '2026-11-30', to: '2026-12-06' })
    expect(noFreeTimeClaim('Esta semana está completo.', TODAY)).toMatchObject({ from: TODAY, to: '2026-11-29' })
  })

  it('leaves alone what cannot be checked against the team-wide list', () => {
    // No dates named.
    expect(noFreeTimeClaim('Por la mañana no tenemos huecos.', TODAY)).toBeNull()
    // One chiropractor's diary.
    expect(noFreeTimeClaim('No tengo huecos con Natacha el miércoles 25 de noviembre.', TODAY, ['Natacha Felix', 'Jordana Aguar'])).toBeNull()
    // A clock time: usually an offer beside the "no".
    expect(noFreeTimeClaim('El jueves 26 no tengo hueco a las 17:00, pero sí a las 18:00.', TODAY)).toBeNull()
    // A question.
    expect(noFreeTimeClaim('¿No te va bien ninguna hora el jueves 26?', TODAY)).toBeNull()
    // Not about free time at all.
    expect(noFreeTimeClaim('Tu cita del miércoles 2 de diciembre a las 16:00 sigue como está.', TODAY)).toBeNull()
  })
})

describe('contradictingTimes', () => {
  it('finds the free morning the 24 Nov reply denied', () => {
    const claim = noFreeTimeClaim('Por la mañana no tenemos huecos en las próximas dos semanas.', TODAY)!
    expect(contradictingTimes(claim, [prompt])).toEqual([{ date: '2026-11-26', time: '12:00' }])
    expect(fullClaimNote(claim, [{ date: '2026-11-26', time: '12:00' }])).toContain('Thursday 2026-11-26 at 12:00')
  })

  it('lets a true claim through', () => {
    const afternoonsOnly: FreeTimesSource = { ...prompt, groups: [{ days: [{ date: '2026-11-26', times: ['15:45'] }], truncatedAfter: null }] }
    const claim = noFreeTimeClaim('Por la mañana no tenemos huecos en las próximas dos semanas.', TODAY)!
    expect(contradictingTimes(claim, [afternoonsOnly])).toBeNull()
  })

  it('needs a time on every kind of visit, not a short adjustment against a first visit', () => {
    const claim = noFreeTimeClaim('Hasta el 14 de diciembre no tenemos huecos por la mañana.', TODAY)!
    const twoKinds: FreeTimesSource = {
      ...prompt,
      groups: [
        { days: [{ date: '2026-11-26', times: ['10:15', '12:00'] }], truncatedAfter: null },
        { days: [{ date: '2026-11-26', times: ['17:30'] }], truncatedAfter: null },
      ],
    }
    expect(contradictingTimes(claim, [twoKinds])).toBeNull()
  })

  it('reads only the dates a list covers, and not past where it was cut short', () => {
    const claim = noFreeTimeClaim('Hasta el 14 de diciembre no tenemos huecos por la mañana.', TODAY)!
    const cut: FreeTimesSource = { ...prompt, groups: [{ days: [{ date: '2026-12-10', times: ['10:00'] }], truncatedAfter: '2026-12-02' }] }
    expect(contradictingTimes(claim, [cut])).toBeNull()
  })
})

// The check inside a reply: back once with the times, refused the second time.

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
const WRONG = 'Por la mañana no tenemos huecos en las próximas dos semanas. ¿Te iría bien por la tarde?'
const RIGHT = 'Por la mañana tengo el jueves 26 de noviembre a las 12:00. ¿Te viene bien?'

function run(turns: Turn[], freeTimes: FreeTimesSource | null = prompt) {
  const { client, seen } = fakeClient(turns)
  const promise = runReceptionistModel(client, {
    model: 'claude-haiku-5-5',
    maxTokens: 1000,
    system: { clinic: 'Clínica', role: 'Recepcionista', conversation: '' } as any,
    messages: [{ role: 'user', content: 'Prefiero de mañanas' }],
    freeTimes,
    internalNotes: [],
    logLabel: 'test',
  })
  return { promise, seen }
}

describe('a reply calling free dates full', () => {
  it('goes back once with the free times named, and the corrected reply is sent', async () => {
    const { promise, seen } = run([says(WRONG), says(RIGHT)])
    const result = await promise
    expect(result.refused).toBe(false)
    expect(result.text).toBe(RIGHT)
    expect(result.checks).toEqual(['full_claim_rewritten'])
    expect(JSON.stringify(seen[1])).toContain('Thursday 2026-11-26 at 12:00')
  })

  it('is refused the second time, so it reaches a person instead of the patient', async () => {
    const { promise } = run([says(WRONG), says(WRONG)])
    const result = await promise
    expect(result.refused).toBe(true)
    expect(result.checks).toEqual(['full_claim_rewritten', 'full_claim_withheld'])
  })

  it('is not checked without the prompt\'s list', async () => {
    const { promise } = run([says(WRONG)], null)
    const result = await promise
    expect(result.text).toBe(WRONG)
    expect(result.checks).toEqual([])
  })
})
