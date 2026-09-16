// Lead conversations, read from the database.
//
// These are rows in whatsapp_messages carrying a lead_id -- the same table
// the patient threads come from. That is what makes the merged-inbox
// decision real rather than cosmetic: one store, one composer, one unread
// count, and a conversation that does not have to hop anywhere when a lead
// becomes a patient.
//
// Only WhatsApp exists. The design also draws Instagram, web chat and
// email; none has a transport or an inbound webhook, so no conversation on
// those channels can exist and none is invented.

export type AiState = 'none' | 'handling' | 'paused' | 'needs_human' | 'blocked'

export interface LeadConversation {
  /** Always `lead:<id>`, so it can never collide with a patient id or phone. */
  key: string
  leadId: string
  name: string
  initials: string
  channel: string
  aiState: AiState
  /** Who took the thread off the AI, once someone has. */
  takenOverBy: string | null
  unread: boolean
  lastMessageAt: string
  preview: string
  /** The previewed message was only recorded by a dry run, never sent. */
  previewWasNotSent?: boolean
  /** A receptionist draft is waiting on a person for this lead. */
  hasDraft?: boolean
  source: string | null
  stage: string
  value: string | null
  patientId: string | null
  phone: string | null
}

export const LEAD_KEY_PREFIX = 'lead:'

export function isLeadConversationKey(key: string | null | undefined) {
  return typeof key === 'string' && key.startsWith(LEAD_KEY_PREFIX)
}

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  webchat: 'Web chat',
  instagram: 'Instagram',
}

export function useGrowthConversations(enabled: Ref<boolean> | ComputedRef<boolean>) {
  const conversations = ref<LeadConversation[]>([])
  const loading = ref(false)
  const { showToast } = useToast()
  const t = useT()

  async function load() {
    if (!enabled.value) return
    loading.value = true
    try {
      const data = await useStaffFetch<{ conversations: LeadConversation[] }>('/api/growth/conversations')
      conversations.value = data.conversations
    } catch {
      // Deliberately quiet. This list is merged into an Inbox that works
      // perfectly well without it -- a failure here must not take the
      // patient threads down with it.
      conversations.value = []
    } finally {
      loading.value = false
    }
  }

  // Watched rather than called once: the tier resolves after mount, so at
  // first run `enabled` is still false.
  watch(enabled, (on) => { if (on) load() }, { immediate: true })

  async function setAiState(leadId: string, state: AiState) {
    const convo = conversations.value.find((c) => c.leadId === leadId)
    const previous = convo?.aiState
    if (convo) convo.aiState = state
    try {
      const result = await useStaffFetch<{ aiState: AiState; takenOverBy: string | null }>(
        `/api/growth/leads/${leadId}/ai-state`,
        { method: 'POST', body: { state } },
      )
      if (convo) {
        convo.aiState = result.aiState
        convo.takenOverBy = result.takenOverBy
      }
    } catch {
      if (convo && previous) convo.aiState = previous
      showToast(t('Could not change who is answering.', 'No se ha podido cambiar quién responde.'), 'error')
    }
  }

  const takeOver = (leadId: string) => setAiState(leadId, 'paused')
  const handBack = (leadId: string) => setAiState(leadId, 'handling')

  return { conversations, loading, reload: load, takeOver, handBack }
}
