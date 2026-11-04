import { describe, it, expect } from 'vitest'
import { offeredTypesSection, patientAudience, rescheduleSection, typesForAudience, type PromptType } from '../../utils/receptionistTypes'
import { buildPatientReplyPrompt } from '../../utils/patientReplyPrompt'
import { receptionistPromptText } from '../../utils/receptionistPrompt'
import { leadNameIsTheirs, newPatientDetails, newPatientDetailsSection } from '../../utils/receptionistTypes'

// Which appointment the receptionist offers depends on who is asking: the
// ad's first-visit offer for someone who answered the ad, the plain first
// visit for anyone else new, and never a first visit for a patient who has
// been before. Read from each type's stage and "bookable by".

const offer: PromptType = { name: 'Oferta Primera visita', durationMinutes: 60, stage: 'first_visit_offer', bookableBy: 'all' }
const first: PromptType = { name: 'Primera visita', durationMinutes: 60, stage: 'first_visit', bookableBy: 'all' }
const adjustment: PromptType = { name: 'Ajuste', durationMinutes: 15, stage: 'adjustment', bookableBy: 'all' }
const maintenance: PromptType = { name: 'Mantenimiento', durationMinutes: 15, stage: 'maintenance', bookableBy: 'existing_patients' }
const all = [offer, first, adjustment, maintenance]
const names = (list: PromptType[]) => list.map((type) => type.name)

describe('Receptionist types by audience', () => {
  it('offers the ad offer to someone from the ad, and nothing else', () => {
    const { types, adOnly } = typesForAudience(all, 'new_from_ad')
    expect(names(types)).toEqual(['Oferta Primera visita'])
    expect(adOnly).toEqual([])
  })

  it('offers the plain first visit to anyone else new, the offer only if they mention the ad', () => {
    const { types, adOnly } = typesForAudience(all, 'new')
    expect(names(types)).toEqual(['Primera visita'])
    expect(names(adOnly)).toEqual(['Oferta Primera visita'])
  })

  it('never offers a returning patient a first visit', () => {
    const { types, adOnly } = typesForAudience(all, 'existing')
    expect(names(types)).toEqual(['Ajuste', 'Mantenimiento'])
    expect(adOnly).toEqual([])
  })

  it('falls back to the plain first visit when a clinic has no offer type', () => {
    expect(names(typesForAudience([first, adjustment], 'new_from_ad').types)).toEqual(['Primera visita'])
  })

  it('leaves a clinic that set no stages as it was: every type, for everyone', () => {
    const plain = [{ name: 'Visita', durationMinutes: 30 }, { name: 'Ajuste', durationMinutes: 15 }]
    expect(names(typesForAudience(plain, 'new').types)).toEqual(['Visita', 'Ajuste'])
    expect(names(typesForAudience(plain, 'new_from_ad').types)).toEqual(['Visita', 'Ajuste'])
    expect(names(typesForAudience(plain, 'existing').types)).toEqual(['Visita', 'Ajuste'])
  })

  it('keeps types bookable only by existing patients away from new people, and the reverse', () => {
    const newOnly: PromptType = { name: 'Valoración', durationMinutes: 30, stage: 'other', bookableBy: 'new_patients' }
    expect(names(typesForAudience([newOnly, maintenance], 'new').types)).toEqual(['Valoración'])
    expect(names(typesForAudience([newOnly, maintenance], 'existing').types)).toEqual(['Mantenimiento'])
  })

  it('says when the ad offer applies', () => {
    const section = offeredTypesSection([first], [offer])
    expect(section).toContain('- Primera visita (60 min)')
    expect(section).toContain('The clinic also has a first-visit offer, which is NOT for everyone')
    expect(section).toContain('- Oferta Primera visita (60 min)')
    // Not volunteered to someone who has not said they qualify, never asked
    // about, and when given, the clinic's offer rather than "the ad's".
    expect(section).toContain('Do not mention it, and do not ask how they found the clinic: give them the regular first-visit price')
    expect(section).toContain('ahora mismo tenemos una oferta de primera visita')
    expect(section).not.toContain('nos has conocido por nuestro anuncio')
    expect(offeredTypesSection([first])).not.toContain('Oferta')
  })

  // Moving a visit keeps its type; a draft leaves cancelling to a person,
  // and offers another day rather than asking first (31 Oct 2026).
  it('moves a booked visit to a new time of the same type, and as a draft leaves cancelling to a colleague', () => {
    const visits = [{ startsAt: '2026-10-20T08:00:00Z', typeName: 'Ajuste' }]
    const section = rescheduleSection(visits, 'Europe/Madrid', { listVisits: true })
    expect(section).toContain('Tuesday 20 October at 10:00 (Ajuste)')
    expect(section).toContain('that same type of appointment')
    expect(section).toContain('do not first ask whether they would rather move it: say your colleague will cancel it')
    expect(section).toContain('in the same reply offer another day')
    expect(section).not.toContain('cancel_appointment')
    expect(rescheduleSection(visits, 'Europe/Madrid', { listVisits: false })).not.toContain('(Ajuste)')
    expect(rescheduleSection([], 'Europe/Madrid', { listVisits: true })).toBe('')
  })

  // Answering on its own, it cancels the visit straight away and offers
  // another day in the same reply. "Quisiera anular la cita" was answered
  // with "¿prefieres cambiarla?", nobody answered, and the visit stayed
  // booked (31 Oct 2026).
  it('cancels a visit straight away when it answers on its own, offers another day, and moves it when they ask to change it', () => {
    const visits = [{ startsAt: '2026-10-20T08:00:00Z', typeName: 'Ajuste' }]
    const section = rescheduleSection(visits, 'Europe/Madrid', { listVisits: true, canBook: true })
    expect(section).toContain('cancel it straight away with cancel_appointment (visit_on = its current day and time)')
    expect(section).toContain('do not first ask whether they would rather move it')
    expect(section).toContain('Si quieres otro día, dime cuál te viene bien y te busco hueco')
    expect(section).toContain('book it with book_appointment as a new visit of the same type as the one cancelled')
    expect(section).toContain('Never leave a visit booked that they have said they will not come to')
    expect(section).toContain('that is a move, not a cancellation')
    expect(section).not.toContain('first ask whether they would like to move it')
    expect(section).toContain('Stopping or pausing their treatment, or cancelling a package, is for a colleague')
    expect(section).not.toContain('hand_over_to_colleague straight away')
    expect(section).not.toContain('your colleague will take care of it')
  })

  // A patient who could not come this week, offered another day, answered
  // "¡Tengo cita el día 5!" -- keep that one, drop this -- and was offered
  // the same two times again (26 Oct 2026).
  it('takes pointing to a visit they already have as no to another time', () => {
    const visits = [{ startsAt: '2026-10-27T18:30:00Z', typeName: 'Ajuste' }, { startsAt: '2026-11-05T16:30:00Z', typeName: 'Ajuste' }]
    const own = rescheduleSection(visits, 'Europe/Madrid', { listVisits: true, canBook: true })
    expect(own).toContain('point to a visit they already have instead')
    expect(own).toContain('Cancel the one they cannot come to with cancel_appointment')
    const draft = rescheduleSection(visits, 'Europe/Madrid', { listVisits: true })
    expect(draft).toContain('your colleague will cancel the one they cannot come to and that the other stands')
  })
})


// A WhatsApp lead carries only a profile name; the patient record the
// receptionist makes from it takes the name and email they wrote instead.
describe('New patient details from the conversation', () => {
  it('takes the name as written, tidied', () => {
    expect(newPatientDetails('  Ana   García López. ', null)).toEqual({ fullName: 'Ana García López', email: null })
    expect(newPatientDetails('A', null).fullName).toBeNull()
    expect(newPatientDetails(42, null).fullName).toBeNull()
  })

  it('takes an email only when it is one', () => {
    expect(newPatientDetails(null, ' Ana.Garcia81@Gmail.com ').email).toBe('ana.garcia81@gmail.com')
    expect(newPatientDetails(null, 'not an email').email).toBeNull()
    expect(newPatientDetails(null, 'a@b').email).toBeNull()
  })
})

// A lead from the ad form already gave its name and email; it was asked for
// the email again just before booking.
describe('What a new patient is asked for before booking', () => {
  it('trusts the name a form asked for, not a profile name', () => {
    expect(leadNameIsTheirs('facebook')).toBe(true)
    expect(leadNameIsTheirs('web')).toBe(true)
    expect(leadNameIsTheirs('whatsapp')).toBe(false)
    expect(leadNameIsTheirs('instagram')).toBe(false)
    expect(leadNameIsTheirs(null)).toBe(false)
  })

  it('asks for nothing the lead already holds', () => {
    const both = newPatientDetailsSection({ name: true, email: true })
    expect(both).toContain('never ask for either')
    expect(both).toContain('leave full_name and email out')
    expect(newPatientDetailsSection({ name: false, email: true })).toMatch(/email is already on record.*first name and surname/s)
    expect(newPatientDetailsSection({ name: true, email: false })).toMatch(/name is already on record.*need their email/s)
    expect(newPatientDetailsSection({ name: false, email: false })).toContain('first name and surname(s) and their email')
  })
})

// A patient writing in is not always somebody who has been. 4 Nov 2026: a
// lead from the ad had her first visit booked as a lead, cancelled it, and
// asked for another date as a patient. The patient path offered returning
// patients' types only, so the receptionist found a time and then handed
// over with nothing to book it as.
describe('Patient audience', () => {
  const fromAd = { channel: 'facebook', source: 'Meta Ads', externalSource: 'facebook', campaign: null, ad: null }
  const onWhatsApp = { channel: 'whatsapp', source: null, externalSource: null, campaign: null, ad: null }

  it('is somebody new from the ad while a lead of theirs came from the ad and they have not been', () => {
    expect(patientAudience({ attended: 0, bonoSessionsLeft: 0, leadOrigins: [fromAd] })).toBe('new_from_ad')
    expect(patientAudience({ attended: 0, bonoSessionsLeft: 0, leadOrigins: [onWhatsApp, fromAd] })).toBe('new_from_ad')
  })

  it('is somebody new, not from the ad, with no lead or none from the ad', () => {
    expect(patientAudience({ attended: 0, bonoSessionsLeft: 0, leadOrigins: [] })).toBe('new')
    expect(patientAudience({ attended: 0, bonoSessionsLeft: 0, leadOrigins: [onWhatsApp] })).toBe('new')
  })

  it('is returning once they came to a visit, or hold a bono, from the ad or not', () => {
    expect(patientAudience({ attended: 1, bonoSessionsLeft: 0, leadOrigins: [fromAd] })).toBe('existing')
    expect(patientAudience({ attended: 0, bonoSessionsLeft: 5, leadOrigins: [fromAd] })).toBe('existing')
  })

  it('offers that patient the ad offer, by name, in the reply prompt', () => {
    const { types, adOnly, regular } = typesForAudience(all, patientAudience({ attended: 0, bonoSessionsLeft: 0, leadOrigins: [fromAd] }))
    const prompt = receptionistPromptText(buildPatientReplyPrompt(
      { personaName: 'Alba', toneLine: 'Courteous and brief.', languages: ['es'], knowledge: [], escalationRules: [], neverSays: '', slotsPerReply: 2, bookingWindowDays: 14 },
      { facts: { firstName: 'Nora', upcoming: [], lastVisitAt: null, plan: null, outstandingCents: null }, offeredTypes: types, adOnlyTypes: adOnly, regularFirstVisit: regular, audience: 'new_from_ad', calendar: { now: new Date('2026-11-04T18:00:00Z'), timeZone: 'Europe/Madrid', availability: null } },
    ))
    expect(prompt).toContain('- Oferta Primera visita (60 min)')
    expect(prompt).toContain('came through one of its ads')
    expect(prompt).not.toContain('- Ajuste (15 min)')
  })
})
