// Paying for visits from the patient app (server/utils/appPayments.ts): the
// card on file, and what each upcoming or recent visit would cost to pay
// now. Read from the server, because the practitioner's own prices and the
// clinic's Stripe settings are not the patient's to read.
//
// Nothing here records money. A saved card that goes straight through is
// booked by the pay route; anything that needs a page -- no saved card, or a
// bank asking for 3-D Secure -- opens in the browser and the webhook books
// it. onReturn runs when the patient comes back from that page, so the
// screen can re-read.
export interface AppPaymentsCard { brand: string; last4: string; expMonth: number; expYear: number }
export interface AppPaymentsVisit { appointmentId: string; state: 'payable' | 'paid'; amountCents: number }

export function useAppPayments(patientId: () => string, onReturn: () => void = () => {}) {
  const t = useT()
  const authedFetch = useAuthedFetch()
  const enabled = ref(false)
  const card = ref<AppPaymentsCard | null>(null)
  // 'payer': a family member's visits, paid with the signed-in person's own
  // card because the person has none (payerCard, server/utils/appPayments.ts).
  const cardOwner = ref<'self' | 'payer'>('self')
  const family = useFamily()
  const visits = ref<AppPaymentsVisit[]>([])
  const loading = ref(true)
  const payingId = ref<string | null>(null)
  const addingCard = ref(false)
  const error = ref('')
  let opened = false

  async function load() {
    if (!patientId()) return
    try {
      const res = await authedFetch<{ enabled: boolean; card: AppPaymentsCard | null; cardOwner?: 'self' | 'payer'; visits: AppPaymentsVisit[] }>('/api/portal/payments', { query: { patientId: patientId() } })
      enabled.value = res.enabled
      card.value = res.card
      cardOwner.value = res.cardOwner ?? 'self'
      visits.value = res.visits
    } catch {
      enabled.value = false
    } finally {
      loading.value = false
    }
  }
  watch(patientId, load, { immediate: true })

  function onVisible() {
    if (document.visibilityState === 'visible' && opened) {
      opened = false
      load()
      onReturn()
    }
  }
  onMounted(() => document.addEventListener('visibilitychange', onVisible))
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))

  function visit(appointmentId: string): AppPaymentsVisit | null {
    return enabled.value ? (visits.value.find((v) => v.appointmentId === appointmentId) ?? null) : null
  }

  async function payVisit(appointmentId: string): Promise<boolean> {
    if (payingId.value) return false
    payingId.value = appointmentId
    error.value = ''
    let paid = false
    try {
      // Opened before the request when there may be a page to show (see
      // openWhenReady); a card that went straight through closes it again.
      await openWhenReady(async () => {
        const res = await authedFetch<{ status: 'paid' | 'processing' | 'redirect'; url?: string }>('/api/portal/appointments/pay', { method: 'POST', body: { appointmentId } })
        if (res.status === 'redirect') {
          opened = true
          return res.url
        }
        paid = true
        return null
      })
      if (paid) {
        await load()
        onReturn()
      }
    } catch (err) {
      const status = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      error.value =
        status === 'card_declined'
          ? t('Your bank declined the payment. Try another card.', 'Tu banco ha rechazado el pago. Prueba con otra tarjeta.')
          : status === 'This visit is already paid.'
            ? t('That visit is already paid.', 'Esa visita ya está pagada.')
            : t("Couldn't take the payment. Try again.", 'No se ha podido hacer el pago. Inténtalo de nuevo.')
      await load()
    } finally {
      payingId.value = null
    }
    return paid
  }

  // A card is always saved to the signed-in person's own record: paying for a
  // child they manage uses it, and it stays theirs.
  const cardHolderId = () => (family.actingForOther.value && family.me.value ? family.me.value.patientId : patientId())

  async function addCard() {
    addingCard.value = true
    error.value = ''
    try {
      await openWhenReady(async () => (await authedFetch<{ url: string }>('/api/portal/card-link', { method: 'POST', body: { patientId: cardHolderId() } })).url)
      opened = true
    } catch {
      error.value = t("Couldn't open the card page. Try again.", 'No se ha podido abrir la página de la tarjeta. Inténtalo de nuevo.')
    } finally {
      addingCard.value = false
    }
  }

  return { enabled, card, cardOwner, visits, loading, payingId, addingCard, error, visit, payVisit, addCard, reload: load }
}
