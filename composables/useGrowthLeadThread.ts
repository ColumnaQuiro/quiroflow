// One lead conversation: its messages, and the context beside them.

export interface LeadThreadMessage {
  id: string
  /** `lead` is them; `clinic` is us. */
  from: 'lead' | 'clinic'
  /** Ours, sent by the AI receptionist on its own -- labelled for the team only. */
  sentByAi?: boolean
  text: string
  channel: string
  status: string
  at: string
  templateName: string | null
  /** image | video | audio | document | sticker, when the message carries a file. */
  mediaType: string | null
  /** Signed for 30 minutes; null when the file is missing from storage. */
  mediaUrl: string | null
  mediaFilename: string | null
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



// A thread that has not answered in this long is treated as failed, so the
// panel offers to try again instead of holding a skeleton until the page is
// reloaded. The route runs in a Netlify function, and a cold one -- or a
// browser session stuck refreshing its token -- could leave the request
// pending for as long as the tab stayed open.
const THREAD_TIMEOUT_MS = 15000

// Each lead's last-loaded thread, newest-used last, so going back to one is
// instant, as the patient threads beside them are. Always refreshed on open;
// only ever a head start. Media links are signed for 30 minutes, and the
// refresh brings fresh ones.
const THREAD_CACHE_SIZE = 40

export function useGrowthLeadThread() {
  const thread = ref<LeadThread | null>(null)
  const loading = ref(false)
  /** The open lead's thread failed to load and there is nothing of it to show. */
  const failed = ref(false)
  const sending = ref(false)
  const drafting = ref(false)
  const { showToast } = useToast()
  const t = useT()

  const cache = new Map<string, LeadThread>()
  function remember(next: LeadThread) {
    cache.delete(next.id)
    cache.set(next.id, next)
    if (cache.size > THREAD_CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  // One request per lead at a time: a hover that started loading it and the
  // click that follows share the same request instead of sending two. A
  // re-read after a change (`fresh`) does not share one that began before it,
  // which would not have the change in it.
  const inflight = new Map<string, Promise<LeadThread>>()
  // The newest request per lead. An older answer arriving after a newer one
  // gives back what the newer one cached rather than its own, older copy.
  const newest = new Map<string, number>()
  let requests = 0
  function fetchThread(leadId: string, fresh = false): Promise<LeadThread> {
    const running = inflight.get(leadId)
    if (running && !fresh) return running
    const n = ++requests
    newest.set(leadId, n)
    let timer: ReturnType<typeof setTimeout> | undefined
    const request: Promise<LeadThread> = Promise.race([
      useStaffFetch<LeadThread>(`/api/growth/leads/${leadId}/thread`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), THREAD_TIMEOUT_MS)
      }),
    ])
      .then((next) => {
        if (newest.get(leadId) !== n) return cache.get(leadId) ?? next
        remember(next)
        return next
      })
      .finally(() => {
        clearTimeout(timer)
        if (inflight.get(leadId) === request) inflight.delete(leadId)
      })
    inflight.set(leadId, request)
    return request
  }

  // The lead whose thread is on screen, or on its way there. An answer for any
  // other lead is not this panel's: opening A and then B used to let A's
  // slower answer land under B's name.
  let wanted: string | null = null

  /**
   * Opens a lead's thread, or with `silent` re-reads the one already open.
   *
   * Silent keeps what is on screen until the answer lands. Every re-read used
   * to clear the thread first, which unmounted it: after each reply the whole
   * panel blinked to a skeleton and came back scrolled to the top.
   *
   * Opening a lead seen recently shows its last-known thread at once and
   * refreshes it behind, rather than a skeleton.
   */
  async function load(leadId: string, opts: { silent?: boolean } = {}) {
    // A silent re-read for a lead no longer open (a reply that finished after
    // someone moved on) refreshes its cache and leaves the screen alone.
    if (opts.silent && wanted !== leadId) {
      await fetchThread(leadId, true).catch(() => {})
      return
    }
    wanted = leadId
    failed.value = false
    if (thread.value?.id !== leadId) thread.value = cache.get(leadId) ?? null
    if (!thread.value) loading.value = true
    try {
      const next = await fetchThread(leadId, !!opts.silent)
      if (wanted !== leadId) return
      thread.value = next
    } catch {
      if (wanted !== leadId) return
      // A failed background refresh keeps what is on screen; only with
      // nothing of theirs to show is it worth saying.
      if (!thread.value) {
        failed.value = true
        showToast(t('Could not open that conversation.', 'No se ha podido abrir la conversación.'), 'error')
      }
    } finally {
      if (wanted === leadId) loading.value = false
    }
  }

  /** Started when the pointer rests on a lead's row, so the click finds it loaded. */
  function prefetch(leadId: string) {
    if (cache.has(leadId) || inflight.has(leadId)) return
    fetchThread(leadId).catch(() => {})
  }

  /** A delivery receipt for one message of the open thread, patched in place. */
  function patchStatus(leadId: string, messageId: string, status: string) {
    const current = thread.value
    if (!current || current.id !== leadId) return
    const i = current.messages.findIndex((m) => m.id === messageId)
    if (i === -1 || current.messages[i]!.status === status) return
    const messages = current.messages.slice()
    messages[i] = { ...messages[i]!, status }
    thread.value = { ...current, messages }
  }

  function appendPending(leadId: string, id: string, text: string, media?: { kind: string; filename: string }) {
    const current = thread.value
    if (!current || current.id !== leadId) return
    const message: LeadThreadMessage = {
      id, from: 'clinic', text, channel: current.channel, status: 'pending', at: new Date().toISOString(),
      templateName: null, mediaType: media?.kind ?? null, mediaUrl: null, mediaFilename: media?.filename ?? null,
    }
    thread.value = { ...current, messages: [...current.messages, message] }
  }

  async function reply(leadId: string, text: string) {
    if (!text.trim()) return false
    sending.value = true
    let pendingId: string | null = null
    try {
      // Instagram has its own route: whatsapp/inbox-send addresses a reply by
      // phone number and an Instagram lead has none, so every answer to a DM
      // came back 400. The lead carries the IGSID, which is what that route
      // resolves it by.
      const path = thread.value?.channel === 'instagram' ? '/api/instagram/send' : '/api/whatsapp/inbox-send'
      // Shown at once with a clock, as a patient thread does -- 'pending'
      // claims nothing about delivery. The row the server wrote replaces it
      // on the re-read below, with its real id and status, so a message
      // WhatsApp refused is never left looking sent.
      pendingId = `pending:${Date.now()}`
      appendPending(leadId, pendingId, text.trim())
      await useStaffFetch(path, { method: 'POST', body: { leadId, text: text.trim() } })
      await load(leadId, { silent: true })
      return true
    } catch (e) {
      if (pendingId) patchStatus(leadId, pendingId, 'failed')
      showToast(serverMessage(e) ?? t('Could not send that reply.', 'No se ha podido enviar la respuesta.'), 'error')
      return false
    } finally {
      sending.value = false
    }
  }

  /**
   * A file or voice note, through the same route a patient thread's go
   * (whatsapp/inbox-send already takes a leadId), so the 24h window, Meta's
   * errors and the stored copy are the ones every other attachment gets.
   * WhatsApp only: instagram/send posts text alone.
   */
  async function sendMedia(leadId: string, media: { base64: string; mimeType: string; filename: string; kind: 'image' | 'video' | 'audio' | 'document' }) {
    sending.value = true
    const pendingId = `pending:${Date.now()}`
    appendPending(leadId, pendingId, '', { kind: media.kind, filename: media.filename })
    try {
      await useStaffFetch('/api/whatsapp/inbox-send', {
        method: 'POST',
        body: { leadId, mediaBase64: media.base64, mediaMimeType: media.mimeType, mediaFilename: media.filename, mediaKind: media.kind },
      })
      await load(leadId, { silent: true })
      return true
    } catch (e) {
      patchStatus(leadId, pendingId, 'failed')
      showToast(serverMessage(e) ?? t('Could not send that file.', 'No se ha podido enviar el archivo.'), 'error')
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
      await load(leadId, { silent: true })
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
      await load(leadId, { silent: true })
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
    wanted = null
    thread.value = null
    failed.value = false
  }

  return { thread, loading, failed, sending, drafting, load, prefetch, patchStatus, reply, sendMedia, draftReply, discardDraft, approveDraft, close }
}
