// Lead conversations, which the Growth tier adds to the existing Inbox
// rather than to an inbox of its own.
//
// That was a deliberate call. Growth could have shipped its own
// Conversations screen -- the design originally drew one -- but then the
// front desk watches two queues, and a lead who books becomes a patient
// mid-thread, so the conversation would have to hop inboxes. Two composers,
// two sets of templates, two unread counts. Instead the tier *upgrades* the
// one inbox the clinic already uses: extra channels, the AI-handling
// filters, the Take over control, and lead context in the right rail. On the
// base plan nothing here loads and the Inbox is exactly what it was.
//
// These are fixtures, like the rest of Growth -- there is no AI receptionist
// and no leads table yet. They are kept as a separate list that the Inbox
// merges in at the display layer, never mixed into the real
// whatsapp_messages rows: a real patient thread must never be decorated with
// an AI badge for state that does not exist.
//
// The names match the leads board on purpose. Valeria and Camila are the
// same people in both places, which is the integration the tier is selling.

export type AiState = 'handling' | 'paused' | 'needs_human' | 'blocked' | 'none'
export type ConversationChannel = 'whatsapp' | 'sms' | 'email' | 'webchat' | 'instagram'

export interface LeadMessageEntry {
  id: string
  from: 'ai' | 'lead' | 'staff'
  text: string
  /** Rendered under the bubble: "AI · WhatsApp · 10:48 · read". */
  meta: string
}

/** A marker in the thread where the AI handed over, not a message. */
export interface LeadEscalation {
  title: string
  reason: string
}

export interface LeadConversationContext {
  subtitle: string
  phone: string
  location: string
  nextAppointment: string
  lastVisit: string
  balance: string
  patientRecord: string
  quickBookService: string
  quickBookSlots: string[]
  tags: string[]
}

export interface LeadConversation {
  /** Always `lead:<id>` so it can never collide with a patient id or phone. */
  key: string
  leadId: string
  name: string
  initials: string
  channel: ConversationChannel
  aiState: AiState
  /** Set when a person takes the thread off the AI. Drives the paused note. */
  takenOverBy?: string
  unread: boolean
  when: string
  preview: string
  /** Header line beside the name in the thread panel. */
  threadSubtitle: string
  aiSummary: string
  dayLabel: string
  messages: LeadMessageEntry[]
  escalation?: LeadEscalation
  context: LeadConversationContext
}

export const LEAD_KEY_PREFIX = 'lead:'

export function isLeadConversationKey(key: string | null | undefined) {
  return typeof key === 'string' && key.startsWith(LEAD_KEY_PREFIX)
}

const FIXTURE: LeadConversation[] = [
  {
    key: 'lead:l-9',
    leadId: 'l-9',
    name: 'Camila Restrepo',
    initials: 'CR',
    channel: 'whatsapp',
    aiState: 'handling',
    unread: false,
    when: '11:01',
    preview: '¿Me lo cubre Adeslas? Y necesito algo esta tarde…',
    threadSubtitle: 'WhatsApp · +34 655 09 71 22 · lead from Missed-call text back',
    aiSummary: 'Alba is qualifying and will offer two slots. Escalates if Camila asks about insurance.',
    dayLabel: 'Today · 10:48',
    messages: [
      { id: 'm-1', from: 'ai', text: 'Hi Camila, sorry we missed your call — this is Alba at Clínica Sants. How can I help?', meta: 'AI · WhatsApp · 10:48 · read' },
      { id: 'm-2', from: 'lead', text: 'Hola, tengo dolor de cuello desde el lunes y no puedo girar la cabeza.', meta: 'Camila · WhatsApp · 10:52' },
      { id: 'm-3', from: 'ai', text: 'Entiendo. ¿Ha habido algún golpe o accidente? Si no, una Valoración Inicial de 45 min con la Dra. Ferrer serían €55.', meta: 'AI · WhatsApp · 10:52' },
      { id: 'm-4', from: 'lead', text: 'No, ningún golpe. ¿Me lo cubre Adeslas? Y necesito algo esta tarde si es posible.', meta: 'Camila · WhatsApp · 11:01' },
    ],
    escalation: { title: 'Escalated to a human', reason: 'Insurance question · rule "insurer named"' },
    context: {
      subtitle: 'Lead · Qualified · owner Nerea',
      phone: '+34 655 09 71 22',
      location: 'Gràcia, Barcelona · Adeslas',
      nextAppointment: 'None yet',
      lastVisit: 'Never · new',
      balance: '€0.00',
      patientRecord: 'Not created',
      quickBookService: 'Initial Assessment · 45 min',
      quickBookSlots: ['Today 19:15', 'Tue 09:30'],
      tags: ['Neck pain', 'Insurance question', 'Same-day'],
    },
  },
  {
    key: 'lead:l-1',
    leadId: 'l-1',
    name: 'Lucía Moreno',
    initials: 'LM',
    channel: 'whatsapp',
    aiState: 'handling',
    unread: true,
    when: '10:58',
    preview: 'Sí, el lunes por la tarde me vendría bien.',
    threadSubtitle: 'WhatsApp · lead from Meta Ads · Sciatica',
    aiSummary: 'Alba is confirming Monday evening and will book once Lucía picks a time.',
    dayLabel: 'Today · 10:55',
    messages: [
      { id: 'm-1', from: 'ai', text: 'Hola Lucía, soy Alba de Clínica Sants. ¿Te vendría bien el lunes por la tarde para la Valoración Inicial?', meta: 'AI · WhatsApp · 10:55 · read' },
      { id: 'm-2', from: 'lead', text: 'Sí, el lunes por la tarde me vendría bien.', meta: 'Lucía · WhatsApp · 10:58' },
    ],
    context: {
      subtitle: 'Lead · Contacted · owner unassigned',
      phone: '+34 611 90 44 27',
      location: 'Sants, Barcelona',
      nextAppointment: 'None yet',
      lastVisit: 'Never · new',
      balance: '€0.00',
      patientRecord: 'Not created',
      quickBookService: 'Initial Assessment · 45 min',
      quickBookSlots: ['Mon 18:30', 'Mon 19:15'],
      tags: ['Sciatica', 'Meta Ads'],
    },
  },
  {
    key: 'lead:l-5',
    leadId: 'l-5',
    name: 'Sofía Ramírez',
    initials: 'SR',
    channel: 'instagram',
    aiState: 'needs_human',
    unread: false,
    when: '09:47',
    preview: 'Cuánto cuesta el masaje deportivo?',
    threadSubtitle: 'Instagram · lead from Instagram DM',
    aiSummary: 'Handed over: the AI has no price for Sports Massage in its knowledge base.',
    dayLabel: 'Today · 09:47',
    messages: [
      { id: 'm-1', from: 'lead', text: 'Cuánto cuesta el masaje deportivo?', meta: 'Sofía · Instagram · 09:47' },
    ],
    escalation: { title: 'Escalated to a human', reason: 'Unknown price · rule "not in knowledge base"' },
    context: {
      subtitle: 'Lead · New · owner unassigned',
      phone: '—',
      location: 'Instagram DM',
      nextAppointment: 'None yet',
      lastVisit: 'Never · new',
      balance: '€0.00',
      patientRecord: 'Not created',
      quickBookService: 'Sports Massage · 30 min',
      quickBookSlots: ['Wed 17:00'],
      tags: ['Sports Massage', 'Price question'],
    },
  },
  {
    key: 'lead:l-2',
    leadId: 'l-2',
    name: 'Adrián Castillo',
    initials: 'AC',
    channel: 'webchat',
    aiState: 'none',
    unread: true,
    when: 'Yest.',
    preview: 'Booked Initial Assessment for Tue 16, 17:00',
    threadSubtitle: 'Web chat · lead from Website form',
    aiSummary: 'Booked by the AI into the clinic calendar.',
    dayLabel: 'Yesterday · 16:20',
    messages: [
      { id: 'm-1', from: 'ai', text: 'That slot is free — I have booked you in for Tuesday 16th at 17:00 in Gràcia with Dr. Ferrer.', meta: 'AI · Web chat · 16:20 · read' },
      { id: 'm-2', from: 'lead', text: 'Perfect, thank you.', meta: 'Adrián · Web chat · 16:22' },
    ],
    context: {
      subtitle: 'Lead · Booked · owner Nerea',
      phone: '+34 677 31 55 08',
      location: 'Gràcia, Barcelona',
      nextAppointment: 'Initial Assessment · Tue 16, 17:00',
      lastVisit: 'Never · new',
      balance: '€0.00',
      patientRecord: 'Not created',
      quickBookService: 'Initial Assessment · 45 min',
      quickBookSlots: ['Tue 17:00 (booked)'],
      tags: ['Website form'],
    },
  },
  {
    key: 'lead:l-13',
    leadId: 'l-13',
    name: 'Elena Sarabia',
    initials: 'ES',
    channel: 'whatsapp',
    aiState: 'blocked',
    unread: false,
    when: 'Yest.',
    preview: 'Queue paused · WhatsApp session expired',
    threadSubtitle: 'WhatsApp · lead from Google Business',
    aiSummary: 'Nothing can be sent until the number is reconnected.',
    dayLabel: 'Yesterday · 12:40',
    messages: [
      { id: 'm-1', from: 'lead', text: '¿Tenéis hueco esta semana?', meta: 'Elena · WhatsApp · 12:40' },
    ],
    context: {
      subtitle: 'Lead · Contacted · owner unassigned',
      phone: '+34 693 12 77 41',
      location: 'Poblenou, Barcelona',
      nextAppointment: 'None yet',
      lastVisit: 'Never · new',
      balance: '€0.00',
      patientRecord: 'Not created',
      quickBookService: 'Initial Assessment · 45 min',
      quickBookSlots: [],
      tags: ['Google Business'],
    },
  },
]

/** The channel a lead's WhatsApp number lost, shown as a banner in the list. */
export const CHANNEL_ALERT = {
  title: 'WhatsApp disconnected',
  detail: '+34 931 22 04 88 lost its session 2 h ago. 9 messages queued.',
  action: 'Reconnect number',
}

export const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  webchat: 'Web chat',
  instagram: 'Instagram',
}

export function useGrowthConversations() {
  const conversations = ref<LeadConversation[]>([])

  onMounted(() => {
    conversations.value = structuredClone(FIXTURE)
  })

  /**
   * Hands a thread from the AI to the person reading it. Local-only for now;
   * the call that actually silences the AI belongs here.
   */
  function takeOver(key: string, staffName: string) {
    const convo = conversations.value.find((c) => c.key === key)
    if (!convo) return
    convo.aiState = 'paused'
    convo.takenOverBy = staffName
  }

  function handBack(key: string) {
    const convo = conversations.value.find((c) => c.key === key)
    if (!convo) return
    convo.aiState = 'handling'
    convo.takenOverBy = undefined
  }

  /**
   * Appends a staff reply to the thread. Local-only, and deliberately without
   * a delivery status in its meta line: a real WhatsApp message here would
   * read "delivered" or "read", and claiming either for a message no API has
   * carried would be the one lie this fixture must not tell.
   */
  function sendReply(key: string, text: string, staffName: string) {
    const convo = conversations.value.find((c) => c.key === key)
    if (!convo || !text.trim()) return
    const channelLabel = CHANNEL_LABEL[convo.channel]
    const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    convo.messages.push({
      id: `m-${convo.messages.length + 1}`,
      from: 'staff',
      text: text.trim(),
      meta: `${staffName} · ${channelLabel} · ${at} · not sent (preview)`,
    })
    convo.preview = text.trim()
  }

  return { conversations, takeOver, handBack, sendReply }
}
