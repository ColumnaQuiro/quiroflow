// Configuration for the AI receptionist: who it is, what it knows, what it
// is allowed to book, and when it must stop and fetch a person.
//
// Fixture, like the rest of Growth -- there is no receptionist to configure
// yet. The shape matters more here than on the other screens though, because
// this is the one that eventually has to round-trip to a model: the
// knowledge cards, booking rules and escalation rules are exactly what a
// system prompt gets built from, so they are modelled as data rather than as
// prose in a textarea.
//
// Note what several knowledge cards say about themselves: "Synced from
// Billing", "Synced from Calendar". The clinic's services, prices and hours
// already exist in this app. The receptionist should read them, not ask the
// owner to type them a second place and then drift.

export interface ReceptionistStat {
  key: string
  label: string
  value: string
  note?: string
}

export interface KnowledgeCard {
  id: string
  title: string
  lines: string[]
  /** Where this came from, or what it makes the AI do. */
  footnote: string
  /** True when the card mirrors data the app already holds. */
  synced: boolean
}

export interface BookingRule {
  label: string
  value: string
}

export interface AppointmentTypeToggle {
  name: string
  enabled: boolean
}

export interface CoverageToggle {
  key: string
  label: string
  enabled: boolean
}

export type ChannelStatus = 'connected' | 'needs_attention' | 'not_set_up'

export interface ReceptionistChannel {
  name: string
  status: ChannelStatus
  statusLabel: string
}

export interface TestChatTurn {
  from: 'ai' | 'patient'
  text: string
}

export interface ReceptionistConfig {
  personaName: string
  languages: string[]
  tones: { label: string; selected: boolean }[]
  neverSays: string
  stats: ReceptionistStat[]
  knowledge: KnowledgeCard[]
  questions: string[]
  appointmentTypes: AppointmentTypeToggle[]
  bookingRules: BookingRule[]
  escalationRules: string[]
  escalationNote: string
  coverage: CoverageToggle[]
  channels: ReceptionistChannel[]
  testChat: TestChatTurn[]
  testChatWhy: string
}

const FIXTURE: ReceptionistConfig = {
  personaName: 'Alba',
  languages: ['Español', 'English', 'Català'],
  tones: [
    { label: 'Warm and brief', selected: true },
    { label: 'Clinical', selected: false },
    { label: 'Chatty', selected: false },
    { label: 'Formal (usted)', selected: false },
  ],
  neverSays: 'No diagnosis, no treatment promises, no claims about insurers. Refers red flags to a chiropractor within one reply.',
  stats: [
    { key: 'conversations', label: 'Conversations this month', value: '148' },
    { key: 'booked', label: 'Booked into the calendar', value: '61', note: '· 41%' },
    { key: 'escalated', label: 'Escalated to a human', value: '12' },
    { key: 'response', label: 'Avg response time', value: '38s' },
  ],
  knowledge: [
    {
      id: 'services',
      title: 'Services and prices',
      lines: ['Initial Assessment · 45 min · €55', 'Adjustment · 20 min · €38', 'Sports Massage · 50 min · €48', 'Shockwave · 25 min · €62'],
      footnote: 'Synced from Billing · 4 services',
      synced: true,
    },
    {
      id: 'hours',
      title: 'Opening hours',
      lines: ['Mon–Fri · 08:00–21:00', 'Sat · 09:00–14:00 (Sants only)', 'Closed 24 Sep · local holiday'],
      footnote: 'Synced from Calendar',
      synced: true,
    },
    {
      id: 'insurance',
      title: 'Insurance',
      lines: ['Private pay only, invoice provided', 'Adeslas and Sanitas: reimbursement', 'No direct billing to insurers'],
      footnote: 'Escalates when an insurer is named',
      synced: false,
    },
    {
      id: 'directions',
      title: 'Directions and parking',
      lines: ['Sants · C/ Sants 142 · M Plaça de Sants', 'Gràcia · C/ Verdi 21 · M Fontana', 'Poblenou · Rambla del Poblenou 88'],
      footnote: '3 locations',
      synced: false,
    },
  ],
  questions: [
    'What brings you in, and how long has it been going on?',
    'Any accident, surgery or pregnancy we should know about?',
    'Have you seen a chiropractor or physio before?',
    'Which location and which times suit you?',
  ],
  appointmentTypes: [
    { name: 'Initial Assessment', enabled: true },
    { name: 'Sports Massage', enabled: true },
    { name: 'Adjustment', enabled: false },
    { name: 'Shockwave', enabled: false },
  ],
  bookingRules: [
    { label: 'Booking window', value: 'Next 14 days' },
    { label: 'Minimum notice', value: '2 hours' },
    { label: 'Practitioners', value: 'Dr. Ferrer · Dr. Lizárraga' },
    { label: 'Slots offered per reply', value: '2' },
    { label: 'Rooms', value: 'Auto-assign (PMS rule)' },
  ],
  escalationRules: [
    'Red-flag symptoms named → hand over now',
    'Insurer named → hand over now',
    'Complaint or refund → hand over now',
    'No slot accepted after 3 offers',
    'Patient asks for a person',
  ],
  escalationNote: "Escalations notify the front-desk queue and the location's WhatsApp group.",
  coverage: [
    { key: 'after_hours', label: 'After-hours answering', enabled: true },
    { key: 'missed_call', label: 'Missed-call text back', enabled: true },
    { key: 'in_hours', label: 'Answer during clinic hours too', enabled: false },
  ],
  channels: [
    { name: 'WhatsApp · +34 931 22 04 88', status: 'needs_attention', statusLabel: 'Reconnect' },
    { name: 'SMS · +34 931 22 04 88', status: 'connected', statusLabel: 'Connected' },
    { name: 'Web chat · quiroflow.es', status: 'connected', statusLabel: 'Connected' },
    { name: 'Instagram DM', status: 'not_set_up', statusLabel: 'Not set up' },
  ],
  testChat: [
    { from: 'ai', text: 'Hola, soy Alba de Clínica Sants. ¿En qué puedo ayudarte?' },
    { from: 'patient', text: 'Hombro derecho, me duele al levantar el brazo. ¿Tenéis hueco el sábado?' },
    { from: 'ai', text: 'Sí. ¿Ha sido por un golpe o ha aparecido poco a poco? El sábado en Sants tengo 09:30 y 12:00 para una Valoración Inicial de 45 min (€55).' },
    { from: 'patient', text: 'Poco a poco. Las 12:00.' },
    { from: 'ai', text: 'Perfecto. En real reservaría sábado 20 a las 12:00 con la Dra. Ferrer, sala asignada automáticamente.' },
  ],
  testChatWhy: 'Knowledge: services and prices · hours (Sat, Sants only) · Booking rule: Initial Assessment, 14-day window',
}

export function useGrowthReceptionist() {
  const config = ref<ReceptionistConfig | null>(null)
  const loading = ref(true)

  onMounted(() => {
    config.value = structuredClone(FIXTURE)
    loading.value = false
  })

  const liveChannelCount = computed(() => config.value?.channels.filter((c) => c.status === 'connected').length ?? 0)

  return { config, loading, liveChannelCount }
}
