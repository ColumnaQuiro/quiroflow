import { describe, expect, it } from 'vitest'
import {
  EARLIER_VISIT_BUTTONS,
  EARLIER_VISIT_MAX_OFFERS,
  earlierCandidates,
  earlierOfferExpiresAt,
  earlierOfferReply,
  earlierSearchWindow,
  earlierVisitLanguage,
  earlierVisitPromptSection,
  earlierVisitReplyText,
  earlierVisitWhen,
  firstFreeCandidate,
  mayOfferToday,
} from '../../utils/earlierVisitOffer'
import { automationFieldValue } from '../../utils/automationFields'
import { receptionistSlotGroups } from '../../utils/receptionistSlots'

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
const TZ = 'Europe/Madrid'
const now = new Date('2026-11-10T09:00:00Z') // Tuesday 10:00 in Madrid

describe('earlierSearchWindow', () => {
  it('looks from three hours from now to twelve hours before their visit', () => {
    const visit = new Date('2026-11-18T16:00:00Z')
    const w = earlierSearchWindow(now, visit)!
    expect(w.from.getTime()).toBe(now.getTime() + 3 * HOUR)
    expect(w.to.getTime()).toBe(visit.getTime() - 12 * HOUR)
  })

  it('has nothing to offer for a visit already close', () => {
    expect(earlierSearchWindow(now, new Date(now.getTime() + 14 * HOUR))).toBeNull()
  })
})

describe('earlierOfferExpiresAt', () => {
  it('gives them 45 minutes to answer', () => {
    expect(earlierOfferExpiresAt(now, new Date(now.getTime() + 24 * HOUR))!.getTime()).toBe(now.getTime() + 45 * MINUTE)
  })

  it('closes 20 minutes before a time that starts soon', () => {
    const slot = new Date(now.getTime() + 50 * MINUTE)
    expect(earlierOfferExpiresAt(now, slot)!.getTime()).toBe(slot.getTime() - 20 * MINUTE)
  })

  it('offers nothing that starts within 20 minutes', () => {
    expect(earlierOfferExpiresAt(now, new Date(now.getTime() + 15 * MINUTE))).toBeNull()
  })
})

describe('mayOfferToday', () => {
  it('offers once a clinic day, up to the cap', () => {
    expect(mayOfferToday({ offers_made: 0, lastOfferedDay: null }, '2026-11-10')).toBe(true)
    expect(mayOfferToday({ offers_made: 1, lastOfferedDay: '2026-11-10' }, '2026-11-10')).toBe(false)
    expect(mayOfferToday({ offers_made: 1, lastOfferedDay: '2026-11-09' }, '2026-11-10')).toBe(true)
    expect(mayOfferToday({ offers_made: EARLIER_VISIT_MAX_OFFERS, lastOfferedDay: '2026-11-01' }, '2026-11-10')).toBe(false)
  })
})

describe('firstFreeCandidate', () => {
  const at = (h: number) => new Date(now.getTime() + h * HOUR)
  const slot = (h: number) => ({ startsAt: at(h), endsAt: at(h + 0.75) })
  const window = { from: at(3), to: at(100) }

  it('takes the earliest time inside the window', () => {
    expect(firstFreeCandidate([slot(30), slot(5), slot(1)], window, [])).toEqual(slot(5))
  })

  it('skips a time already offered to somebody else', () => {
    expect(firstFreeCandidate([slot(5), slot(30)], window, [{ startsAt: at(5.5), endsAt: at(6) }])).toEqual(slot(30))
  })

  it('finds nothing past the window', () => {
    expect(firstFreeCandidate([slot(120)], window, [])).toBeNull()
  })
})

describe('earlierOfferReply', () => {
  it('reads every language variant of both buttons', () => {
    for (const buttons of Object.values(EARLIER_VISIT_BUTTONS)) {
      expect(earlierOfferReply(buttons.accept)).toBe('accept')
      expect(earlierOfferReply(buttons.decline)).toBe('decline')
    }
  })

  it('ignores accents, case and punctuation of the button title', () => {
    expect(earlierOfferReply('si adelantar')).toBe('accept')
    expect(earlierOfferReply('NO, ME QUEDO CON LA MIA')).toBe('decline')
  })

  it('leaves typed answers to the receptionist', () => {
    expect(earlierOfferReply('Sí')).toBeNull()
    expect(earlierOfferReply('Sí, ¿y a las 18:00?')).toBeNull()
    expect(earlierOfferReply('No')).toBeNull()
    expect(earlierOfferReply('')).toBeNull()
  })

  it('keeps every button within WhatsApp\'s 25 characters', () => {
    for (const buttons of Object.values(EARLIER_VISIT_BUTTONS)) {
      expect(buttons.accept.length).toBeLessThanOrEqual(25)
      expect(buttons.decline.length).toBeLessThanOrEqual(25)
    }
  })
})

describe('language and wording', () => {
  it('writes in their language when the template has it, else Spanish', () => {
    expect(earlierVisitLanguage('fr')).toBe('fr')
    expect(earlierVisitLanguage('en_US')).toBe('en')
    expect(earlierVisitLanguage('de')).toBe('es')
    expect(earlierVisitLanguage(null)).toBe('es')
  })

  it('says the time on the clinic\'s clock in each language', () => {
    const at = '2026-11-12T16:00:00Z' // Thursday 17:00 in Madrid
    expect(earlierVisitWhen(at, TZ, 'es')).toBe('jueves, 12 de noviembre, a las 17:00')
    expect(earlierVisitWhen(at, TZ, 'fr')).toBe('jeudi 12 novembre à 17:00')
    expect(earlierVisitWhen(at, TZ, 'en')).toBe('Thursday 12 November at 17:00')
  })

  it('fills the template variables in the language the template goes out in', () => {
    const recipient = { firstName: 'Ana', lastName: null, email: null }
    const context = { clinicTimezone: TZ, earlierSlotAt: '2026-11-12T16:00:00Z', earlierVisitAt: '2026-11-18T16:00:00Z' }
    expect(automationFieldValue(recipient, 'earlier_slot_datetime', { ...context, language: 'fr' })).toBe('jeudi 12 novembre à 17:00')
    expect(automationFieldValue(recipient, 'earlier_visit_datetime', { ...context, language: 'es' })).toBe('miércoles, 18 de noviembre, a las 17:00')
  })

  it('answers a tap in their language', () => {
    expect(earlierVisitReplyText('moved', 'es', { moved: 'jueves', kept: 'miércoles' })).toContain('adelantada al jueves')
    expect(earlierVisitReplyText('taken', 'fr', { kept: 'mercredi' })).toContain('Vous gardez votre première visite du mercredi')
    expect(earlierVisitReplyText('declined', 'en', { kept: 'Wednesday' })).toContain('keep your first visit on Wednesday')
  })
})

describe('earlierVisitPromptSection', () => {
  it('tells the receptionist exactly how to move to the offered time', () => {
    const text = earlierVisitPromptSection(
      { status: 'offered', visitAt: '2026-11-18T16:00:00Z', offeredAt: '2026-11-12T16:00:00Z', expiresAt: '2026-11-10T09:45:00Z' },
      TZ,
      { canBook: true, canStop: true },
    )
    expect(text).toContain('move_visit_on "2026-11-18 17:00", date 2026-11-12, time 17:00')
    expect(text).toContain('open until 10:45')
    expect(text).toContain('stop_earlier_time_offers')
  })

  it('without booking, passes the move to a colleague', () => {
    const text = earlierVisitPromptSection({ status: 'offered', visitAt: '2026-11-18T16:00:00Z', offeredAt: '2026-11-12T16:00:00Z', expiresAt: null }, TZ, {})
    expect(text).not.toContain('book_appointment')
    expect(text).not.toContain('stop_earlier_time_offers')
  })

  it('says only that one may come while nothing is on offer', () => {
    const text = earlierVisitPromptSection({ status: 'waiting', visitAt: '2026-11-18T16:00:00Z', offeredAt: null, expiresAt: null }, TZ, { canStop: true })
    expect(text).toContain('If an earlier time frees up')
    expect(text).not.toContain('move_visit_on')
  })

  it('is empty with nothing to say', () => {
    expect(earlierVisitPromptSection(null, TZ, {})).toBe('')
  })
})

describe('earlierCandidates', () => {
  // The diary as the receptionist computes it (receptionistSlotGroups), for
  // one first-visit type: a list names its types by name and length, never
  // by id, so matching on an id there found nothing at all (CI, 10 Nov 2026).
  const ALL_DAY: [string, string][] = [['09:00', '20:00']]
  const hours = { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY }
  const availability = receptionistSlotGroups({
    now,
    clinics: [{ id: 'clinic-1', name: 'Clínica Demo', timeZone: TZ, businessHours: hours }],
    practitioners: [{ id: 'p-1', businessHours: hours, clinicIds: ['clinic-1'] }],
    types: [{ id: 'type-1', name: 'Primera visita oferta', durationMinutes: 45 }],
    // Busy from 13:00 to 14:00 Madrid today.
    appointments: [{ practitionerId: 'p-1', starts_at: '2026-11-10T12:00:00Z', ends_at: '2026-11-10T13:00:00Z' }],
    blocks: [],
    bookingWindowDays: 3,
    minimumNoticeMinutes: 180,
  })

  it('turns the listed times into instants with the visit\'s length', () => {
    const candidates = earlierCandidates(availability, 'clinic-1', TZ, 45)
    expect(candidates.length).toBeGreaterThan(0)
    const first = candidates[0]!
    // Three hours' notice from 10:00 Madrid, and 13:00-14:00 is taken.
    expect(first.startsAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 3 * HOUR)
    expect(candidates.some((c) => c.startsAt < new Date('2026-11-10T13:00:00Z') && c.endsAt > new Date('2026-11-10T12:00:00Z'))).toBe(false)
    expect(first.endsAt.getTime() - first.startsAt.getTime()).toBe(45 * MINUTE)
  })

  it('finds nothing at another clinic', () => {
    expect(earlierCandidates(availability, 'clinic-2', TZ, 45)).toEqual([])
  })
})
