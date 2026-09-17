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
  /** Which way a reply goes out: 'whatsapp', 'instagram', and so on. */
  channel: string
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
  /** A reply the receptionist wrote, waiting on a person. Never sent. */
  draft: string | null
  draftAt: string | null
  /** The switch on Growth > Receptionist. Off means it drafts nothing. */
  receptionistEnabled: boolean
  messages: LeadThreadMessage[]
}



export function useGrowthLeadThread() {
  const thread = ref<LeadThread | null>(null)
  const loading = ref(false)
  const sending = ref(false)
  const drafting = ref(false)
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
      // Instagram has its own route: whatsapp/inbox-send addresses a reply by
      // phone number and an Instagram lead has none, so every answer to a DM
      // came back 400. The lead carries the IGSID, which is what that route
      // resolves it by.
      const path = thread.value?.channel === 'instagram' ? '/api/instagram/send' : '/api/whatsapp/inbox-send'
      await useStaffFetch(path, { method: 'POST', body: { leadId, text: text.trim() } })
      // Reloaded rather than appended optimistically: the row the server
      // wrote carries the delivery status and the id, and a message shown as
      // sent that WhatsApp actually refused is the one mistake worth a round
      // trip to avoid on a thread the clinic is answerable for.
      await load(leadId)
      return true
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not send that reply.', 'No se ha podido enviar la respuesta.'), 'error')
      return false
    } finally {
      sending.value = false
    }
  }

  /** Asks the receptionist for a reply. Writes a draft; sends nothing. */
  async function draftReply(leadId: string) {
    drafting.value = true
    try {
      const result = await useStaffFetch<{ available: boolean; draft: string; refused?: boolean }>(
        `/api/growth/leads/${leadId}/draft-reply`,
        { method: 'POST' },
      )
      if (!result.available) {
        showToast(t('The AI receptionist is not configured on this deployment.', 'La recepcionista IA no está configurada en este despliegue.'), 'error')
        return false
      }
      if (result.refused || !result.draft) {
        // The model declining to write this is an answer, not a failure --
        // said plainly rather than shown as a broken request.
        showToast(t('The receptionist did not want to answer this one -- reply yourself.', 'La recepcionista no ha querido responder a este -- respóndele tú.'))
        return false
      }
      await load(leadId)
      return true
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not draft a reply.', 'No se ha podido redactar una respuesta.'), 'error')
      return false
    } finally {
      drafting.value = false
    }
  }

  async function discardDraft(leadId: string) {
    try {
      await useStaffFetch(`/api/growth/leads/${leadId}/draft-reply`, { method: 'DELETE' })
      await load(leadId)
    } catch {
      showToast(t('Could not discard that draft.', 'No se ha podido descartar el borrador.'), 'error')
    }
  }

  /**
   * Sends the draft, then clears it.
   *
   * The clear is deliberately after the send succeeds and deliberately not
   * inside the send route: a draft that survives its own send is a draft
   * somebody sends twice, and /api/whatsapp/inbox-send is the same route the
   * composer uses to type a reply by hand -- it should know nothing about
   * drafts.
   */
  async function approveDraft(leadId: string, text: string) {
    const sent = await reply(leadId, text)
    if (sent) await discardDraft(leadId)
    return sent
  }

  function close() {
    thread.value = null
  }

  return { thread, loading, sending, drafting, load, reply, draftReply, discardDraft, approveDraft, close }
}
