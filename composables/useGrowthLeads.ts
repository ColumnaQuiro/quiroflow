// Shape of the leads pipeline, plus the fixture that currently fills it.
//
// Same arrangement as useGrowthDashboard: no leads tables exist yet, so this
// serves the design's worked example from behind the call signature the real
// loader will have. When the schema lands, keep the interfaces, replace the
// body of useGrowthLeads(), and drop the fixture.
//
// Moving a card between stages mutates this local copy only. The API call
// belongs in moveLead() below, which is deliberately the single place the
// board changes a lead's stage.

/** Channel a lead arrived on. Rendered as a short monospace tag on the card. */
export type LeadChannel = 'WA' | 'SMS' | 'TEL' | 'WEB' | 'IG'

export interface GrowthLead {
  id: string
  name: string
  channel: LeadChannel
  source: string
  /** The AI receptionist is mid-conversation with this person right now. */
  aiHandling?: boolean
  /** Appointment line shown in green -- booked, attended, or converted. */
  appointment?: string
  timeInStage: string
  value: string
}

export interface GrowthLeadColumn {
  key: string
  title: string
  /** Total in the stage, which can exceed cards.length -- see `more`. */
  count: number
  value: string
  cards: GrowthLead[]
  /** "+16 more" footer where the stage holds more than the board renders. */
  more?: string
  /** Shown instead of cards when the stage is genuinely empty. */
  emptyTitle?: string
  emptyDetail?: string
}

export interface GrowthLeadsSummary {
  openLeads: number
  estimatedValue: string
  clinics: string
  handledByAi: number
}

const FIXTURE: GrowthLeadColumn[] = [
  {
    key: 'new',
    title: 'New Lead',
    count: 6,
    value: '€6,030 est.',
    cards: [
      { id: 'l-1', name: 'Lucía Moreno', channel: 'WA', source: 'Meta Ads · Sciatica', aiHandling: true, timeInStage: '12 min in stage', value: '€1,005' },
      { id: 'l-2', name: 'Adrián Castillo', channel: 'WEB', source: 'Website form', timeInStage: '48 min in stage', value: '€1,005' },
      { id: 'l-3', name: 'Beatriz Ferreira', channel: 'TEL', source: 'Missed call', aiHandling: true, timeInStage: '1 h in stage', value: '€680' },
      { id: 'l-4', name: 'Hugo Delgado', channel: 'WA', source: 'Google Ads · Neck', timeInStage: '3 h in stage', value: '€1,005' },
      { id: 'l-5', name: 'Sofía Ramírez', channel: 'IG', source: 'Instagram DM', timeInStage: '5 h in stage', value: '€420' },
      { id: 'l-6', name: 'Tom Whitaker', channel: 'WEB', source: 'Google Business', timeInStage: '9 h in stage', value: '€1,005' },
    ],
  },
  {
    key: 'contacted',
    title: 'Contacted',
    count: 23,
    value: '€21,140 est.',
    more: '+16 more',
    cards: [
      { id: 'l-7', name: 'Valeria Ocampo', channel: 'WA', source: 'Meta Ads · Back pain', aiHandling: true, timeInStage: '2 h in stage', value: '€1,005' },
      { id: 'l-8', name: 'Íñigo Barrenetxea', channel: 'WA', source: 'Google Ads', timeInStage: '6 h in stage', value: '€1,005' },
      { id: 'l-9', name: 'Camila Restrepo', channel: 'SMS', source: 'Missed-call text back', aiHandling: true, timeInStage: '1 d in stage', value: '€680' },
      { id: 'l-10', name: 'Pau Vidal', channel: 'TEL', source: 'Referral · A. Serra', timeInStage: '1 d in stage', value: '€1,005' },
      { id: 'l-11', name: 'Noelia Prats', channel: 'WEB', source: 'Website form', timeInStage: '2 d in stage', value: '€420' },
      { id: 'l-12', name: 'Mateo Quiroga', channel: 'WA', source: 'Meta Ads · Sports', aiHandling: true, timeInStage: '2 d in stage', value: '€890' },
      { id: 'l-13', name: 'Elena Sarabia', channel: 'WA', source: 'Google Business', timeInStage: '3 d in stage', value: '€1,005' },
    ],
  },
  {
    key: 'qualified',
    title: 'Qualified',
    count: 5,
    value: '€4,905 est.',
    cards: [
      { id: 'l-14', name: 'Rubén Ortega', channel: 'WA', source: 'Google Ads · Shockwave', timeInStage: '40 min in stage', value: '€1,240' },
      { id: 'l-15', name: 'Martina Lozano', channel: 'WA', source: 'Meta Ads · Posture', aiHandling: true, timeInStage: '3 h in stage', value: '€1,005' },
      { id: 'l-16', name: 'Diego Fuentes', channel: 'TEL', source: 'Walk-in enquiry', timeInStage: '1 d in stage', value: '€680' },
      { id: 'l-17', name: 'Aitana Roig', channel: 'WEB', source: 'Website form', timeInStage: '1 d in stage', value: '€1,005' },
      { id: 'l-18', name: 'Joaquín Bermúdez', channel: 'IG', source: 'Instagram DM', timeInStage: '2 d in stage', value: '€975' },
    ],
  },
  {
    key: 'booked',
    title: 'Booked',
    count: 9,
    value: '€9,045 est.',
    cards: [
      { id: 'l-19', name: 'Carmen Iriarte', channel: 'WA', source: 'Meta Ads', appointment: 'Initial Assessment · Mon 15, 10:30 · Sants', timeInStage: '4 h in stage', value: '€1,005' },
      { id: 'l-20', name: 'Santiago Peralta', channel: 'WEB', source: 'Google Ads', appointment: 'Initial Assessment · Tue 16, 17:00 · Gràcia', timeInStage: '1 d in stage', value: '€1,005' },
      { id: 'l-21', name: 'Irene Castellanos', channel: 'TEL', source: 'Referral', appointment: 'Adjustment · Wed 17, 09:15 · Sants', timeInStage: '1 d in stage', value: '€680' },
      { id: 'l-22', name: 'Luis Etxeberria', channel: 'WA', source: 'Google Business', appointment: 'Sports Massage · Thu 18, 19:30', timeInStage: '2 d in stage', value: '€420' },
    ],
  },
  {
    key: 'showed',
    title: 'Showed',
    count: 4,
    value: '€3,890 est.',
    cards: [
      { id: 'l-23', name: 'Andrea Bonilla', channel: 'WA', source: 'Meta Ads', appointment: 'Attended Fri 12 · 09:00', timeInStage: '1 d in stage', value: '€1,005' },
      { id: 'l-24', name: 'Óscar Villanueva', channel: 'TEL', source: 'Missed call', appointment: 'Attended Fri 12 · 11:45', timeInStage: '1 d in stage', value: '€880' },
      { id: 'l-25', name: 'Nuria Alcázar', channel: 'WEB', source: 'Website form', appointment: 'Attended Thu 11 · 18:15', timeInStage: '2 d in stage', value: '€1,005' },
      { id: 'l-26', name: 'Felipe Andrade', channel: 'WA', source: 'Google Ads', appointment: 'Attended Thu 11 · 20:00', timeInStage: '2 d in stage', value: '€1,000' },
    ],
  },
  {
    key: 'converted',
    title: 'Converted',
    count: 7,
    value: '€7,035 care plans',
    cards: [
      { id: 'l-27', name: 'Marta Espinosa', channel: 'WA', source: 'Meta Ads', appointment: '12-visit plan · patient record open', timeInStage: 'Converted 2 d ago', value: '€1,005' },
      { id: 'l-28', name: 'Gonzalo Ferrán', channel: 'TEL', source: 'Referral', appointment: '8-visit plan · patient record open', timeInStage: 'Converted 3 d ago', value: '€720' },
      { id: 'l-29', name: 'Paula Sanchis', channel: 'WEB', source: 'Google Ads', appointment: '12-visit plan · patient record open', timeInStage: 'Converted 4 d ago', value: '€1,005' },
    ],
  },
  {
    key: 'lost',
    title: 'Lost',
    count: 0,
    value: '€0',
    cards: [],
    emptyTitle: 'No lost leads',
    emptyDetail: 'Nothing closed out in the last 30 days.',
  },
]

const SUMMARY: GrowthLeadsSummary = {
  openLeads: 54,
  estimatedValue: '€61,300',
  clinics: 'Clínica Sants, Gràcia and Poblenou',
  handledByAi: 19,
}

export function useGrowthLeads() {
  const columns = ref<GrowthLeadColumn[]>([])
  const summary = ref<GrowthLeadsSummary | null>(null)
  const loading = ref(true)

  onMounted(() => {
    // structuredClone so a drag mutates this instance, not the module-level
    // fixture -- without it the board would keep its moved cards across a
    // remount, which no real loader would do.
    columns.value = structuredClone(FIXTURE)
    summary.value = SUMMARY
    loading.value = false
  })

  /**
   * Moves a lead into `toKey`, optionally before the card at `beforeId`.
   * The single place the board changes a stage -- the PATCH goes here.
   */
  function moveLead(leadId: string, toKey: string, beforeId?: string) {
    const from = columns.value.find((c) => c.cards.some((card) => card.id === leadId))
    const to = columns.value.find((c) => c.key === toKey)
    if (!from || !to) return
    const index = from.cards.findIndex((card) => card.id === leadId)
    const [lead] = from.cards.splice(index, 1)
    if (!lead) return

    // Dropping a card back where it already was still lands here; counts must
    // not drift, so they are recomputed from the arrays rather than adjusted.
    const at = beforeId ? to.cards.findIndex((card) => card.id === beforeId) : -1
    if (at === -1) to.cards.push(lead)
    else to.cards.splice(at, 0, lead)

    // `count` can exceed the rendered cards (a stage showing "+16 more"), so
    // shift the stored total by the same delta rather than overwriting it.
    if (from !== to) {
      from.count = Math.max(0, from.count - 1)
      to.count += 1
      lead.timeInStage = 'just now'
    }
  }

  return { columns, summary, loading, moveLead }
}
