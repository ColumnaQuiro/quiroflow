import { beforeEach, describe, expect, it, vi } from 'vitest'

// A time accepted from the receptionist's offer, booked by code
// (server/utils/receptionistOffers.ts) -- and the one nobody booked, found by
// the 15-minute job.

vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: () => null }))
vi.mock('~/server/utils/receptionist', () => ({ findChiropractor: () => null, loadReceptionistCalendar: async () => ({}) }))
const book = vi.fn()
vi.mock('~/server/utils/receptionistBooking', () => ({ bookingTool: () => book }))
const announce = vi.fn(async (..._args: unknown[]) => {})
vi.mock('~/server/utils/receptionistSend', () => ({ announceHandover: (...args: unknown[]) => announce(...args) }))
const { acceptOfferedTime, handOverAcceptedUnbooked, keepOffer } = await import('../../server/utils/receptionistOffers')

type Row = Record<string, any>

/** Enough of the Supabase client for these reads and writes, over rows in memory. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= [])
    const filters: ((row: Row) => boolean)[] = []
    let patch: Row | null = null
    let limit = Infinity
    let order: { column: string; ascending: boolean } | null = null
    const matching = () => {
      let found = rows.filter((row) => filters.every((f) => f(row)))
      if (order) found = [...found].sort((a, b) => String(a[order!.column]).localeCompare(String(b[order!.column])) * (order!.ascending ? 1 : -1))
      return found.slice(0, limit)
    }
    const run = () => {
      const found = matching()
      if (patch) for (const row of found) Object.assign(row, patch)
      return { data: found, error: null }
    }
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gt: (c: string, v: string) => (filters.push((r) => r[c] > v), q),
      lte: (c: string, v: string) => (filters.push((r) => r[c] <= v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      order: (column: string, opts?: { ascending?: boolean }) => ((order = { column, ascending: opts?.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      update: (values: Row) => ((patch = values), q),
      insert: async (values: Row | Row[]) => {
        for (const value of Array.isArray(values) ? values : [values]) rows.push({ id: `row-${rows.length + 1}`, status: 'open', created_at: new Date().toISOString(), ...value })
        return { error: null }
      },
      upsert: async (value: Row) => (rows.push(value), { error: null }),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    }
    return q
  }
  return { from, tables }
}

const ACCOUNT = 'acc-1'
const PATIENT = '11111111-1111-4111-8111-111111111111'
const SLOTS = [
  { date: '2026-12-02', time: '16:30', practitionerId: 'p-1', practitionerName: 'Marta Ríos' },
  { date: '2026-12-09', time: '17:15', practitionerId: 'p-1', practitionerName: 'Marta Ríos' },
]
const offerRow = (over: Row = {}) => ({ id: 'offer-1', account_id: ACCOUNT, conversation_key: PATIENT, slots: SLOTS, type_name: null, move_visit_on: '2026-11-26 09:30', pinned: false, any_chiropractor: false, auto: true, status: 'open', created_at: '2026-11-23T09:30:20.000Z', ...over })
const BOOKED = { moved: true, typeName: 'Mantenimiento', slot: { date: '2026-12-02', time: '16:30' }, practitionerName: 'Marta Ríos', quiet: false, address: null, near: [], earlierOffer: false, repeatLateChange: false, forSomeoneElse: false }
const ours = { createdAt: '2026-11-23T09:30:17.000Z', sentByAi: true, automated: false }

function accept(db: ReturnType<typeof fakeDb>, over: Partial<Parameters<typeof acceptOfferedTime>[0]> = {}) {
  return acceptOfferedTime({ service: db, accountId: ACCOUNT, conversationKey: PATIENT, actions: {} as any, ours, inbound: ['miércoles 2 · 16:30'], language: 'es', newPersonReady: true, ...over })
}

beforeEach(() => {
  book.mockReset()
  announce.mockClear()
  vi.useFakeTimers({ now: new Date('2026-11-23T10:00:00.000Z') })
})

describe('a time accepted from its offer', () => {
  it('is moved in code, with the visit the offer was for, and confirmed with no model', async () => {
    book.mockResolvedValue({ content: 'Moved.', isError: false, booked: BOOKED })
    const result = await accept(fakeDb({ receptionist_offers: [offerRow()] }))
    expect(book).toHaveBeenCalledWith({ date: '2026-12-02', time: '16:30', move_visit_on: '2026-11-26 09:30' })
    expect(result?.kind).toBe('reply')
    if (result?.kind !== 'reply') return
    expect(result.run.text).toBe('Hecho: tu cita queda cambiada al miércoles 2 de diciembre a las 16:30, con Marta.')
    expect(result.run.inCode).toBe(true)
    expect(result.run.usage.rounds).toBe(0)
    expect(result.run.toolUses).toEqual([{ name: 'book_appointment', input: { date: '2026-12-02', time: '16:30', move_visit_on: '2026-11-26 09:30' }, ok: true }])
    expect(result.run.checks).toEqual(['accepted_in_code'])
  })

  it('books a new visit as the type it was offered as, with the chiropractor it was offered with', async () => {
    // 23 Nov 2026: offered "with another chiropractor", booked with their own.
    book.mockResolvedValue({ content: 'Booked.', isError: false, booked: { ...BOOKED, moved: false } })
    await accept(fakeDb({ receptionist_offers: [offerRow({ move_visit_on: null, type_name: 'Mantenimiento', pinned: true, any_chiropractor: true })] }))
    expect(book).toHaveBeenCalledWith({ date: '2026-12-02', time: '16:30', appointment_type: 'Mantenimiento', chiropractor: 'Marta Ríos', any_chiropractor: true })
  })

  it('reads words as well as a tap', async () => {
    book.mockResolvedValue({ content: 'Moved.', isError: false, booked: { ...BOOKED, slot: { date: '2026-12-09', time: '17:15' } } })
    const result = await accept(fakeDb({ receptionist_offers: [offerRow()] }), { inbound: ['El miércoles 9 me viene genial'] })
    expect(book).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-12-09', time: '17:15' }))
    expect(result?.kind).toBe('reply')
  })

  it("is the model's when the booking is refused", async () => {
    book.mockResolvedValue({ content: '16:30 on 2026-12-02 was taken a moment ago.', isError: true })
    expect(await accept(fakeDb({ receptionist_offers: [offerRow()] }))).toBeNull()
  })

  it('hands the model a booking whose confirmation needs its words', async () => {
    book.mockResolvedValue({ content: 'Moved. They have done that twice before.', isError: false, booked: { ...BOOKED, repeatLateChange: true } })
    const result = await accept(fakeDb({ receptionist_offers: [offerRow()] }))
    expect(result).toEqual({ kind: 'booked', input: { date: '2026-12-02', time: '16:30', move_visit_on: '2026-11-26 09:30' }, details: { ...BOOKED, repeatLateChange: true }, note: 'Moved. They have done that twice before.' })
  })

  it.each([
    ['something was said after the offer', { ours: { ...ours, createdAt: '2026-11-23T09:40:00.000Z' } }],
    ['a person wrote last', { ours: { ...ours, sentByAi: false } }],
    ['a reminder went out last', { ours: { ...ours, automated: true } }],
    ['they asked for something else', { inbound: ['Me gustaría cita por la tarde'] }],
    ['they tapped "another day"', { inbound: ['Otro día'] }],
    ['someone new has not given their name yet', { newPersonReady: false }],
  ])('books nothing when %s', async (_name, over) => {
    expect(await accept(fakeDb({ receptionist_offers: [offerRow()] }), over as any)).toBeNull()
    expect(book).not.toHaveBeenCalled()
  })

  it('books nothing from an offer the code may not book from, or one already closed', async () => {
    expect(await accept(fakeDb({ receptionist_offers: [offerRow({ auto: false })] }))).toBeNull()
    expect(await accept(fakeDb({ receptionist_offers: [offerRow({ status: 'booked' })] }))).toBeNull()
    expect(await accept(fakeDb({ receptionist_offers: [offerRow({ created_at: '2026-11-10T09:30:20.000Z' })] }), { ours: { ...ours, createdAt: '2026-11-10T09:30:17.000Z' } })).toBeNull()
    expect(book).not.toHaveBeenCalled()
  })
})

describe('keeping an offer', () => {
  it('replaces the conversation\'s open one', async () => {
    const db = fakeDb({ receptionist_offers: [offerRow()] })
    await keepOffer(db, ACCOUNT, PATIENT, { slots: [SLOTS[1]!], typeName: null, moveVisitOn: '2026-11-26 09:30', pinned: false, anyChiropractor: false, auto: true })
    expect(db.tables.receptionist_offers!.map((row) => row.status)).toEqual(['superseded', 'open'])
    expect(db.tables.receptionist_offers![1]).toMatchObject({ conversation_key: PATIENT, slots: [SLOTS[1]], move_visit_on: '2026-11-26 09:30', auto: true })
  })
})

describe('a time accepted that the diary does not have', () => {
  const tap = { account_id: ACCOUNT, patient_id: PATIENT, direction: 'inbound', body_preview: 'miércoles 2 · 16:30', created_at: '2026-11-23T09:35:00.000Z' }
  const tables = (over: Record<string, Row[]> = {}) => ({
    receptionist_offers: [offerRow()],
    whatsapp_messages: [tap],
    patient_app_messages: [],
    appointments: [],
    inbox_reply_drafts: [],
    clinics: [{ account_id: ACCOUNT, timezone: 'Europe/Madrid', archived_at: null, created_at: '2026-01-01' }],
    patients: [{ id: PATIENT, account_id: ACCOUNT, first_name: 'Lucía' }],
    ...over,
  })

  it('is passed to a person, with the time, once', async () => {
    const db = fakeDb(tables())
    expect(await handOverAcceptedUnbooked(db)).toEqual([{ key: PATIENT, outcome: 'handed_over' }])
    expect(announce).toHaveBeenCalledTimes(1)
    expect(announce.mock.calls[0]![4]).toContain('miércoles 2 de diciembre a las 16:30')
    expect(db.tables.receptionist_offers![0]!.status).toBe('alerted')
    expect(db.tables.inbox_reply_drafts![0]).toMatchObject({ conversation_key: PATIENT, handed_over_at: expect.any(String) })
    expect(await handOverAcceptedUnbooked(db)).toEqual([])
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('is closed when the visit is there', async () => {
    // 16:30 in Madrid in December is 15:30 UTC.
    const db = fakeDb(tables({ appointments: [{ id: 'a-1', account_id: ACCOUNT, patient_id: PATIENT, starts_at: '2026-12-02T15:30:00.000Z', status: 'booked', deleted_at: null }] }))
    expect(await handOverAcceptedUnbooked(db)).toEqual([{ key: PATIENT, outcome: 'booked' }])
    expect(announce).not.toHaveBeenCalled()
  })

  it('is left to whoever has answered them since', async () => {
    const db = fakeDb(tables({ whatsapp_messages: [tap, { account_id: ACCOUNT, patient_id: PATIENT, direction: 'outbound', body_preview: 'Te lo miro', created_at: '2026-11-23T09:36:00.000Z' }] }))
    expect(await handOverAcceptedUnbooked(db)).toEqual([{ key: PATIENT, outcome: 'answered' }])
    expect(announce).not.toHaveBeenCalled()
  })

  it('waits while the reply may still be on its way, and for an answer that accepts nothing', async () => {
    expect(await handOverAcceptedUnbooked(fakeDb(tables({ whatsapp_messages: [{ ...tap, created_at: '2026-11-23T09:55:00.000Z' }] })))).toEqual([])
    expect(await handOverAcceptedUnbooked(fakeDb(tables({ whatsapp_messages: [{ ...tap, body_preview: 'Otro día' }] })))).toEqual([])
    expect(announce).not.toHaveBeenCalled()
  })
})
