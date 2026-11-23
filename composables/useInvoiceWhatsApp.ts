// "Send by WhatsApp" beside every "Send by email" on a receipt or a factura.
//
// One place for the three things each of those buttons needs: whether it can
// be pressed for this patient, the sentence that says why not, and the send.
// The answer comes from the server (/api/whatsapp/invoice-send-status), which
// asks the same question the send does, so a button is never enabled for a
// send that is then refused.

import type { MaybeRefOrGetter } from 'vue'

type Blocker = 'not_connected' | 'no_template' | 'minor' | 'no_phone' | 'bad_phone'
type DocumentKind = 'invoice' | 'factura'

export function useInvoiceWhatsApp(patientId: MaybeRefOrGetter<string | null | undefined>) {
  const t = useT()

  // 'checking' until the server has answered, 'unknown' when it could not:
  // both keep the button disabled, since nothing says a send would work.
  const state = ref<Blocker | 'checking' | 'unknown' | null>('checking')

  async function refresh() {
    const id = toValue(patientId)
    if (!id) {
      state.value = 'checking'
      return
    }
    try {
      const { blocker } = await useStaffFetch<{ blocker: Blocker | null }>('/api/whatsapp/invoice-send-status', { query: { patientId: id } })
      // A patient switched while this was in flight keeps its own answer.
      if (toValue(patientId) === id) state.value = blocker
    } catch {
      if (toValue(patientId) === id) state.value = 'unknown'
    }
  }
  // Client only: the answer depends on the signed-in session, and a disabled
  // button is the right thing to render until it arrives.
  onMounted(() => {
    watch(() => toValue(patientId), refresh, { immediate: true })
  })

  const canSend = computed(() => state.value === null)
  /** The clinic's to fix in Settings > WhatsApp, as opposed to this patient's record. */
  const needsSetup = computed(() => state.value === 'not_connected' || state.value === 'no_template')

  /** Why the button is disabled, for its tooltip; empty when it is not. */
  const reason = computed(() => {
    switch (state.value) {
      case null:
        return ''
      case 'not_connected':
        return t('WhatsApp is not connected. Connect it in Settings › WhatsApp.', 'WhatsApp no está conectado. Conéctalo en Ajustes › WhatsApp.')
      case 'no_template':
        return t('Choose the template for receipts and invoices in Settings › WhatsApp first.', 'Elige antes la plantilla de recibos y facturas en Ajustes › WhatsApp.')
      case 'minor':
        return t('Not sent by WhatsApp to a patient who is under age.', 'No se envía por WhatsApp a un paciente menor de edad.')
      case 'no_phone':
        return t('This patient has no phone number. Add one to their record.', 'Este paciente no tiene número de teléfono. Añádelo en su ficha.')
      case 'bad_phone':
        return t('This patient’s phone number is not valid for WhatsApp.', 'El número de teléfono de este paciente no es válido para WhatsApp.')
      case 'unknown':
        return t('Could not check whether WhatsApp is set up.', 'No se pudo comprobar si WhatsApp está configurado.')
      default:
        return t('Checking WhatsApp…', 'Comprobando WhatsApp…')
    }
  })

  /** The id of the document on its way, and what became of each one sent from here. */
  const sendingId = ref('')
  const results = ref<Record<string, { ok: boolean; message: string }>>({})

  async function send(kind: DocumentKind, id: string) {
    if (!canSend.value || sendingId.value) return
    sendingId.value = id
    const { [id]: _previous, ...rest } = results.value
    results.value = rest
    try {
      await useStaffFetch(`/api/${kind === 'factura' ? 'facturas' : 'invoices'}/${id}/send-whatsapp`, { method: 'POST' })
      results.value = { ...results.value, [id]: { ok: true, message: t('Sent by WhatsApp', 'Enviado por WhatsApp') } }
    } catch (e: any) {
      // Meta's own words when it refused the message, the server's when it
      // never got that far: either names what to fix.
      const detail = e?.data?.statusMessage ?? e?.data?.message
      results.value = {
        ...results.value,
        [id]: { ok: false, message: detail ? t(`WhatsApp did not send it: ${detail}`, `WhatsApp no lo envió: ${detail}`) : t('Could not send by WhatsApp', 'No se pudo enviar por WhatsApp') },
      }
    } finally {
      sendingId.value = ''
    }
  }

  return { canSend, needsSetup, reason, sendingId, results, send, refresh }
}
