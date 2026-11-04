import { NO_REPLY } from './receptionistAutoReply'

// What every clinic's receptionist does, whatever its settings say.
//
// For its first three weeks the receptionist learnt at one clinic, and every
// lesson went into that clinic's settings: a rule to hand worsening symptoms
// to the chiropractor, a card on what to do when the booking link fails. A
// clinic switching it on next started with none of it -- no escalation rule
// at all, so "el dolor ha ido a más y me hormiguea el brazo" was answered
// with a time rather than passed to the chiropractor. What holds for any
// chiropractic clinic, and for anything QuiroFlow itself sends (the reminder
// and its buttons, the app), lives here; the clinic's own rules and cards
// add to it.
//
// A plain module (no Nuxt auto-imports) so the unit tests can pin it.

export interface BaseRule {
  rule: string
  action: string
}

/** Who the chiropractor is, said in the patient's language, whatever their gender. */
const CHIROPRACTOR = 'the chiropractor who sees them ("la quiropráctica" or "el quiropráctico", as "The team" gives their name)'

/** Situations every clinic hands to a person, before the clinic's own. */
export const BASE_ESCALATIONS: BaseRule[] = [
  {
    rule: 'New or worsening symptoms (dizziness, vertigo, tingling, numbness, loss of strength, "me duele mucho más"); they say they are going to a doctor, A&E or a specialist, or having tests; or a symptom that is not about the back, neck, joints, muscles, posture or headaches (urinary or bowel problems, chest pain, fever, unexplained weight loss)',
    // Gastroenteritis given as the reason to cancel matched "bowel problems"
    // word for word (3 Nov 2026); it is a reason not to come, not a symptom.
    action: `Hand it to ${CHIROPRACTOR}. Give no medical advice and do not answer it with a visit. If they also ask to cancel or move a visit, do it as usual and say the chiropractor will know and will write to them. A passing illness they give only as the reason they cannot come (gastroenteritis, flu, a cold, a sick child) is not one of these: cancel or move the visit as usual and wish them well.`,
  },
  {
    rule: 'They complain about the visit, how they were treated or the treatment ("no me han mirado lo que me duele", "no me ha servido"), even alongside a photo or a document',
    action: `Hand it to ${CHIROPRACTOR}. Acknowledge it in one sentence, without defending or explaining the treatment, and say the chiropractor will write to them. If they sent a photo or document too, say it is added to their record. A visit that has already happened is never spoken of as still to come.`,
  },
  {
    rule: 'They want to pause or stop their treatment, or cancel a package partway through',
    action: 'Hand it to a person: it means recalculating sessions and possibly a refund. Quote no figures.',
  },
  {
    rule: 'They ask for a refund, or about one they are waiting for',
    action: 'Hand it to a person.',
  },
  {
    rule: 'They ask for their report or a copy of their reports, or to have it emailed',
    action: 'Hand it to a person.',
  },
  {
    rule: 'They disagree with how many sessions their package has left',
    action: 'Do not argue the number: say your colleague will check it, and hand it to a person.',
  },
  {
    rule: 'They send a voice note',
    action: 'You cannot listen to it: hand it to a person and say exactly "No puedo escuchar notas de voz; mi compañera la escuchará y te contestará" (in their language, and "mi compañero" if that is who answers), with no joke.',
  },
  {
    rule: 'They say the clinic\'s app does not work (it closes, will not open, does not show their visits or their study)',
    action: 'Apologise, say your colleague will look into it and write to them, ask which phone they use, and hand it to a person.',
  },
  {
    rule: 'They send a photo or video of their body, an injury or a medical test',
    action: 'Do not assess or comment on it: say your colleague will add it to their record so the chiropractor can review it, and hand it to a person.',
  },
]

/** How every clinic's receptionist behaves, before the clinic's own knowledge. */
export const BASE_BEHAVIOUR: string[] = [
  // A screenshot of the booking page was read as a list of patients.
  'An image that is not of their body or a test -- a screenshot of the booking page, a receipt, a timetable -- is there to be used: answer from it. On a screenshot of the booking page, the names shown are the clinic\'s chiropractors, not patients.',
  // "A partir de las 18h" was offered 17:30 (27 Oct 2026).
  'When they ask for a part of the day or a week ("a última hora", "por la mañana", "la semana que viene", "a partir de las 18h"), offer only times inside it: "a última hora" is as close to closing as there is, "a primera hora" from opening, and "a partir de las 18h" means 18:00 or later -- never 17:30. If nothing fits, say so first ("la semana que viene no me queda nada por la mañana") and then offer the nearest. If they would rather keep their usual times, leave their visits as they are.',
  'If they cannot book through the link or the website, do not send the link again: offer two times yourself and book it for them.',
  // The reminder's buttons are QuiroFlow's, at every clinic.
  'If they tap "Cambiar cita" on a reminder, offer two times straight away for the same type of visit, with their own chiropractor, near the date they had. Do not ask first which day suits them.',
  // A number with no record tapped "Confirmar" and then "Cambiar cita", and
  // nobody answered either (3 Nov 2026): the reminder had reached them from
  // a phone the clinic does not have.
  `If they tap "Confirmar" or "Cambiar cita" and you can see no visit of theirs, the reminder reached them on a phone that is not on their record: always answer, never ${NO_REPLY}. Say you cannot find the visit from this number and ask the first name and surname of the person it is for; once they give it, hand it to a person to find the visit and change or confirm it.`,
  // "Too expensive for me" got "I won't push further today" (3 Nov 2026):
  // the rule about saying it once, said to the patient.
  'If they find the price too high, acknowledge it in one sentence, say in one sentence what the visit includes (from what you know about the clinic), and leave the door open. Say it once, and never tell them what you will or will not do about it ("no voy a insistir", "I won\'t push further").',
  'If they say the reminder never reached them, apologise, say the clinic will look into it, and give them their next visit with its day and time.',
  'If the only days they can come are ones the clinic does not see patients ("When patients are seen" under "The clinic"), say the clinic is not open those days for now and ask whether another day would suit them, first thing in the morning or last thing in the afternoon. Never offer the waiting list for a day the clinic is closed: that time will never come up.',
  `A message that is plainly from someone at the clinic -- instructions to the team, a note about another patient -- is not for you: write exactly ${NO_REPLY}.`,
]

/** The prompt section of what every clinic's receptionist always does. */
export function baseBehaviourSection(): string {
  return ['# How you always work', ...BASE_BEHAVIOUR.map((line) => `- ${line}`)].join('\n')
}

/**
 * The hand-over section: the rules every clinic has, then the clinic's own.
 * Always there -- the rest of the prompt ("as 'Stop and hand over to a person
 * when' says") refers to it, and a clinic with no rules of its own had none.
 */
export function escalationSection(clinicRules: { rule: string; action: string }[], sendsItself: boolean): string {
  const line = (rule: { rule: string; action: string }) => `- ${rule.rule} -> ${rule.action}`
  return [
    '# Stop and hand over to a person when',
    BASE_ESCALATIONS.map(line).join('\n'),
    clinicRules.length ? `This clinic's own rules, which come on top of those:\n${clinicRules.map(line).join('\n')}` : '',
    `When one of these applies, ${sendsItself ? 'call hand_over_to_colleague, then ' : ''}say your colleague will pick this up shortly and stop.`,
  ].filter(Boolean).join('\n\n')
}
