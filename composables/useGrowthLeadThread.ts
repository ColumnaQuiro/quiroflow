// One lead conversation: its messages, and the context beside them.

export interface LeadThreadMessage {
  id: string
  /** `lead` is them; `clinic` is us. Who on our side is not recorded. */
  from: 'lead' | 'clinic'
  text: string
  channel: string
  status: string
  at: string
  templateName: string | null
}

export interface LeadThread {
  id: string
  name: string
  phone: string | null
  email: string | null
  source: string | null
  stage: string
  value: string | null
  aiState: import('~/composables/useGrowthConversations').AiState
  takenOverBy: string | null
  takenOverAt: string | null
  clinic: string | null
  patientId: string | null
  patientBalance: string | null
  /**
   * WhatsApp refuses free-form replies more than 24h after the last inbound
   * message. Known before the composer opens, so nobody types a message that
   * is going to be rejected on send.
   */
  canReplyFreeText: boolean
  messages: LeadThreadMessage[]
}

export function useGrowthLeadThread() {
  const thread = ref<LeadThread | null>(null)
  const loading = ref(false)
  const sending = ref(false)
  const { showToast } = useToast()
  const t = useT()

  async function load(leadId: string) {
    loading.value = true
    thread.value = null
    try {
      thread.value = await useStaffFetch<LeadThread>(`/api/growth/leads/${leadId}/thread`)
    } catch {
      showToast(t('Could not open that conversation.', 'No se ha podido abrir la conversación.'), 'error')
    } finally {
      loading.value = false
    }
  }

  async function reply(leadId: string, text: string) {
    if (!text.trim()) return false
    sending.value = true
    try {
      await useStaffFetch('/api/whatsapp/inbox-send', { method: 'POST', body: { leadId, text: text.trim() } })
      // Reloaded rather than appended optimistically: the row the server
      // wrote carries the delivery status and the id, and a message shown as
      // sent that WhatsApp actually refused is the one mistake worth a round
      // trip to avoid on a thread the clinic is answerable for.
      await load(leadId)
      return true
    } catch (e) {
      showToast((e as { statusMessage?: string }).statusMessage ?? t('Could not send that reply.', 'No se ha podido enviar la respuesta.'), 'error')
      return false
    } finally {
      sending.value = false
    }
  }

  function close() {
    thread.value = null
  }

  return { thread, loading, sending, load, reply, close }
}
