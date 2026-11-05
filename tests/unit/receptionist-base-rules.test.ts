import { describe, it, expect } from 'vitest'
import { BASE_ESCALATIONS, baseBehaviourSection, escalationSection } from '../../utils/receptionistBaseRules'
import { briefingLeak, internalNotes } from '../../utils/receptionistGuard'
import { buildPatientReplyPrompt, type PatientPromptConfig } from '../../utils/patientReplyPrompt'
import { receptionistPromptText } from '../../utils/receptionistPrompt'

// What every clinic's receptionist does, whatever its settings say. A clinic
// switching it on used to start with no escalation rule at all, so worsening
// symptoms were answered with a time (1 Nov 2026).

const config: PatientPromptConfig = {
  personaName: 'Alba',
  toneLine: 'Courteous and brief.',
  languages: ['es'],
  knowledge: [],
  escalationRules: [],
  neverSays: '',
  slotsPerReply: 2,
  bookingWindowDays: 14,
}
const base = {
  facts: { firstName: 'Ana', upcoming: [], lastVisitAt: null, plan: null, outstandingCents: null },
  offeredTypes: [],
  calendar: { now: new Date('2026-11-02T10:00:00Z'), timeZone: 'Europe/Madrid', availability: null },
}

describe('Hand-over rules every clinic has', () => {
  it('covers the safety cases', () => {
    const rules = BASE_ESCALATIONS.map((rule) => rule.rule).join('\n')
    for (const topic of ['worsening symptoms', 'complain', 'pause or stop their treatment', 'refund', 'report', 'sessions their package has left', 'voice note', 'app does not work', 'photo or video of their body']) {
      expect(rules).toContain(topic)
    }
  })

  it('reaches a clinic with no rules of its own', () => {
    const prompt = receptionistPromptText(buildPatientReplyPrompt(config, { ...base, sendsItself: true }))
    expect(prompt).toContain('# Stop and hand over to a person when')
    expect(prompt).toContain('New or worsening symptoms')
    expect(prompt).toContain('call hand_over_to_colleague, then say your colleague will pick this up shortly')
    expect(prompt).not.toContain("This clinic's own rules")
  })

  it("keeps the clinic's own rules, after the common ones", () => {
    const section = escalationSection([{ rule: 'Pregunta por el parking', action: 'Pasar a una persona.' }], false)
    expect(section.indexOf('New or worsening symptoms')).toBeLessThan(section.indexOf('Pregunta por el parking'))
    expect(section).toContain("This clinic's own rules, which come on top of those:")
    expect(section).not.toContain('hand_over_to_colleague')
  })

  it('names the chiropractor by the team, whatever their gender', () => {
    expect(BASE_ESCALATIONS[0]!.action).toContain('"la quiropráctica" or "el quiropráctico", as "The team" gives their name')
  })
})

describe('Behaviour every clinic has', () => {
  it('is in every prompt', () => {
    const prompt = receptionistPromptText(buildPatientReplyPrompt(config, base))
    expect(prompt).toContain('# How you always work')
    expect(prompt).toContain('"a partir de las 18h" means 18:00 or later')
    expect(prompt).toContain('do not send the link again')
    expect(prompt).toContain('If they tap "Cambiar cita" on a reminder')
    expect(prompt).toContain('Never offer the waiting list for a day the clinic is closed')
  })

  // 3 Nov 2026: "Cambiar cita" from a number with no record went unanswered,
  // and a price objection was told "I won't push further today".
  it('answers a reminder button from a number with no visit', () => {
    const section = baseBehaviourSection()
    expect(section).toContain('you can see no visit of theirs')
    expect(section).toContain('always answer, never NO_REPLY')
  })

  it('answers a price objection without announcing what it will do', () => {
    expect(baseBehaviourSection()).toContain('never tell them what you will or will not do about it')
  })

  // 2 and 4 Nov 2026: "os avisaré" got "avísanos", then "No os aviso yo :)"
  // to the next reminder got nothing, and the visit stayed booked.
  it('asks whether to cancel a visit they may not come to, rather than staying quiet', () => {
    const section = baseBehaviourSection()
    expect(section).toContain('"no os aviso yo"')
    expect(section).toContain('never answer NO_REPLY and never just say "avísanos"')
    expect(section).toContain('ask in one sentence whether you should cancel that visit')
  })

  it('does not hand over a passing illness given as the reason to cancel', () => {
    expect(BASE_ESCALATIONS[0]!.action).toContain('gastroenteritis')
  })

  it('leaves a message from the team unanswered', () => {
    expect(baseBehaviourSection()).toContain('plainly from someone at the clinic')
    expect(baseBehaviourSection()).toContain('write exactly NO_REPLY')
  })
})

describe('Words a rule asks to be said are not a leak', () => {
  // The rule asks for these words; saying them is not quoting the briefing.
  it('lets the reply use them', () => {
    const rules = [{ rule: 'Se queja de la visita', action: 'Pasar a la quiropráctica. Decir: «Siento que te hayas ido con esa sensación; se lo paso a la quiropráctica y te escribe ella.»' }]
    const notes = internalNotes({ escalationRules: rules, neverSays: '' })
    expect(briefingLeak('Siento que te hayas ido con esa sensación; se lo paso a la quiropráctica y te escribe ella.', notes)).toBeNull()
    expect(briefingLeak('No puedo escuchar notas de voz; mi compañera la escuchará y te contestará.', notes)).toBeNull()
  })

  it('still catches the rest of a rule being quoted', () => {
    const notes = internalNotes({ escalationRules: [], neverSays: '' })
    expect(briefingLeak('Te cuento: it means recalculating sessions and possibly a refund. Quote no figures.', notes)).toBe('quotes an internal rule')
  })
})
