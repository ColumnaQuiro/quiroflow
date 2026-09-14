// The lead drawer's contents: one unified timeline from first touch to
// showing up, plus the attribution and consent rail beside it.
//
// The timeline is the argument the whole Growth tier makes -- a form
// submission, the AI's actual WhatsApp conversation, what it concluded, the
// appointment it put in the real clinic calendar, the reminder, the visit --
// so it is modelled as one ordered list of typed entries rather than
// separate per-source feeds that a screen would have to interleave.
//
// Fixture for now, same as the rest of Growth. The drawer renders whatever
// entries it is handed, so a real loader only has to produce this shape.

export type LeadTimelineKind = 'form' | 'conversation' | 'qualification' | 'appointment' | 'reminder' | 'pending'

export interface LeadMessage {
  from: 'ai' | 'lead'
  text: string
}

export interface LeadTimelineEntry {
  id: string
  kind: LeadTimelineKind
  title: string
  time: string
  /** Prose line under the title. Used by every kind except `conversation`. */
  detail?: string
  /** `conversation` only: the transcript, oldest first. */
  messages?: LeadMessage[]
  /** `qualification` only: the verdict chip. */
  verdict?: string
  /** `appointment` only: the booked slot, shown as its own card. */
  slot?: string
  slotDetail?: string
}

export interface LeadAttributionRow {
  label: string
  value: string
}

export interface GrowthLeadDetail {
  id: string
  reference: string
  name: string
  initials: string
  createdAt: string
  aiHandling: boolean
  stage: string
  source: string
  value: string
  owner: string
  contact: string[]
  attribution: LeadAttributionRow[]
  consent: string[]
  timeline: LeadTimelineEntry[]
}

const DETAIL: GrowthLeadDetail = {
  id: 'l-7',
  reference: 'LEAD-2026-0918',
  name: 'Valeria Ocampo',
  initials: 'VO',
  createdAt: 'created 11 Sep, 19:42',
  aiHandling: true,
  stage: 'Qualified',
  source: 'Meta Ads · Back pain',
  value: '€1,005',
  owner: 'Nerea Bilbao · front desk',
  contact: ['+34 622 47 19 03', 'valeria.ocampo@gmail.com', 'Sants-Montjuïc, Barcelona', 'Prefers evenings after 19:00'],
  attribution: [
    { label: 'Campaign', value: 'ES · Back pain · Sants 5km' },
    { label: 'Ad', value: 'Video · "3 weeks of back pain?"' },
    { label: 'Keyword / audience', value: 'Lookalike 1% · pain interest' },
    { label: 'First touch', value: 'Instagram Reels · 9 Sep' },
    { label: 'Last touch', value: 'Meta lead form · 11 Sep' },
    { label: 'Cost per lead', value: '€6.90' },
  ],
  consent: ['WhatsApp opt-in · 11 Sep', 'Data processing · accepted', 'Marketing email · not asked'],
  timeline: [
    {
      id: 't-1',
      kind: 'form',
      title: 'Meta lead form submitted',
      time: '11 Sep, 19:42',
      detail: '"Lower back pain for 3 weeks, worse when sitting." · Prefers evenings · Postcode 08014',
    },
    {
      id: 't-2',
      kind: 'conversation',
      title: 'AI receptionist · WhatsApp',
      time: '19:42 – 19:51 · first reply in 34s',
      messages: [
        { from: 'ai', text: 'Hi Valeria, this is Alba from Clínica Sants. Thanks for your message about lower back pain. Has it been constant for the three weeks, or does it come and go?' },
        { from: 'lead', text: 'Comes and goes, worse after work. I sit all day.' },
        { from: 'ai', text: 'Understood. An Initial Assessment with Dr. Ferrer is €55 and takes 45 minutes. We have Monday 15th at 19:30 or Tuesday 16th at 20:00 in Sants. Which suits you?' },
        { from: 'lead', text: 'Monday 19:30 works.' },
      ],
    },
    {
      id: 't-3',
      kind: 'qualification',
      title: 'Qualification result',
      time: '19:50',
      verdict: 'Qualified · musculoskeletal, no red flags',
      detail: 'Adult · no recent surgery · not pregnant · no imaging required · private pay, no insurer',
    },
    {
      id: 't-4',
      kind: 'appointment',
      title: 'Appointment booked in the clinic calendar',
      time: '19:51',
      slot: 'Initial Assessment · Mon 15 Sep, 19:30 · Room 2',
      slotDetail: 'Dr. Marta Ferrer · Clínica Sants · room auto-assigned · €55 deposit not required',
    },
    {
      id: 't-5',
      kind: 'reminder',
      title: 'Reminder sent',
      time: '12 Sep, 09:00 · WhatsApp',
      detail: 'Delivered and read · confirmed with "Sí, allí estaré"',
    },
    {
      id: 't-6',
      kind: 'pending',
      title: 'Showed for appointment',
      time: 'Pending · Mon 15 Sep',
      detail: 'Marked automatically when the front desk checks her in.',
    },
  ],
}

export function useGrowthLeadDetail() {
  // Every card opens the same worked example for now. A real loader takes the
  // id and returns that lead; the drawer already renders whatever it is given.
  function loadLead(_id: string): GrowthLeadDetail {
    return DETAIL
  }

  return { loadLead }
}
