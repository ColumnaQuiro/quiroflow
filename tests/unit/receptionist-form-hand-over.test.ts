import { describe, expect, it, vi } from 'vitest'

// The calendar is not read here: find_free_times is not offered.
vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist',() => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const { runReceptionistModel } = await import('../../server/utils/receptionistModel')

// 17 Nov 2026: migraines "cada vez más intensas y frecuentes", written only
// in the ad's form, got two replies about the price and never reached the
// chiropractor. The prompt was told the escalation rules apply to the form,
// and the model then handed over one time in three. The handover is decided
// before the model is asked (formSymptomToHandOver) and stands whatever it
// writes.

type Turn = { stop_reason: string; content: unknown[] }

function run(turns: Turn[], opts: { handOver?: boolean; mustHandOver?: string | null } = {}) {
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
  const book = vi.fn(async () => ({ content: 'Booked.', isError: false }))
  const promise = runReceptionistModel(client as any, {
    model: 'claude-haiku-5-5',
    maxTokens: 1000,
    system: { clinic: 'Clínica', role: 'Recepcionista', conversation: '' } as any,
    messages: [{ role: 'user', content: '¿Seguirá siendo de 50 € o cambia?' }],
    handOver: opts.handOver ?? true,
    mustHandOver: 'mustHandOver' in opts ? opts.mustHandOver : REASON,
    book,
    internalNotes: [],
    logLabel: 'test',
  })
  return { promise, seen, book }
}

const REASON = 'En el formulario escribió: «Migrañas cada vez más frecuentes».'
const PRICE = 'La primera visita sigue con la oferta de 50 €.'
const says = (text: string): Turn => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] })
const calls = (name: string, input: unknown): Turn => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name, input }] })

describe('a handover decided before the model is asked', () => {
  it('goes with the reply though the model only answered the price', async () => {
    const result = await run([says(PRICE)]).promise
    expect(result.text).toBe(PRICE)
    expect(result.refused).toBe(false)
    expect(result.handedOver).toBe(REASON)
    expect(result.checks).toContain('form_handed_over')
  })

  it('keeps the model\'s own reason when it handed over itself', async () => {
    const own = 'En el formulario describe migrañas que empeoran: que la valore la quiropráctica.'
    const { promise, seen } = run([calls('hand_over_to_colleague', { reason: own }), says(`${PRICE} Le paso lo que nos cuentas a la quiropráctica.`)])
    const result = await promise
    expect(result.handedOver).toBe(own)
    expect(result.checks).not.toContain('form_handed_over')
    // What they asked is still answered in the last message.
    expect(JSON.stringify(seen[1]!.at(-1))).toContain('first answer what they asked')
  })

  it('refuses a booking meanwhile, without reaching the diary', async () => {
    const { promise, seen, book } = run([calls('book_appointment', { appointment_type: 'Primera visita', date: '2026-11-24', time: '10:00' }), says(PRICE)])
    const result = await promise
    expect(book).not.toHaveBeenCalled()
    expect(result.toolUses.filter((t) => t.name === 'book_appointment' && t.ok)).toEqual([])
    expect(JSON.stringify(seen[1]!.at(-1))).toContain('goes to the chiropractor first')
    expect(result.handedOver).toBe(REASON)
  })

  it('does nothing behind a draft, which a person reads anyway', async () => {
    const result = await run([says(PRICE)], { handOver: false }).promise
    expect(result.handedOver).toBeNull()
  })

  it('and nothing when there is none: the reply goes as it always did', async () => {
    const { promise, book } = run([calls('book_appointment', { appointment_type: 'Primera visita', date: '2026-11-24', time: '10:00' }), says('Cita confirmada.')], { mustHandOver: null })
    const result = await promise
    expect(book).toHaveBeenCalledOnce()
    expect(result.handedOver).toBeNull()
  })
})
