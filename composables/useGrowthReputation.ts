// Reputation, read from the database.
//
// Two halves with very different footing, and the shape says which is which:
//
//   Reviews  -- only what has been imported or entered by hand. Ratings and
//               review text live inside Google, Doctoralia and Facebook,
//               behind an OAuth integration per platform that does not exist
//               yet, so `hasReviews: false` means "nothing to show", not
//               "zero stars".
//   Requests -- ours end to end. We sent it, and the link goes through our
//               own redirect, so sent and opened are exact. Whether someone
//               then wrote a review is on the platform's side of the fence.

export interface ReputationReview {
  id: string
  platform: string
  location: string | null
  author: string
  rating: number
  body: string
  postedAt: string
  repliedAt: string | null
  replyBody: string | null
  replyWasAiDrafted: boolean
  draftBody: string | null
}

export interface ReputationData {
  hasReviews: boolean
  rating: number | null
  reviewCount: number
  distribution: { stars: number; count: number }[]
  trend: { label: string; value: number }[]
  trendLabel: string | null
  pendingCount: number
  reviews: ReputationReview[]
  funnel: {
    sent: number
    opened: number
    openedShare: number | null
    converted: number
    /** null when nothing has been attributed -- "0%" would be a claim. */
    convertedShare: number | null
  }
}

export function useGrowthReputation() {
  const data = ref<ReputationData | null>(null)
  const loading = ref(true)
  const busyId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const { showToast } = useToast()
  const t = useT()

  async function load() {
    try {
      data.value = await useStaffFetch<ReputationData>('/api/growth/reputation')
      error.value = null
    } catch {
      error.value = t('Could not load reputation.', 'No se ha podido cargar la reputación.')
    } finally {
      loading.value = false
    }
  }
  onMounted(load)

  async function draftReply(reviewId: string) {
    busyId.value = reviewId
    try {
      const result = await useStaffFetch<{ available: boolean; draft: string; refused?: boolean }>(
        `/api/growth/reputation/${reviewId}/draft-reply`,
        { method: 'POST' },
      )
      if (!result.available) {
        showToast(t('Drafting needs an Anthropic API key on the server.', 'Redactar necesita una clave de API de Anthropic en el servidor.'), 'error')
        return
      }
      if (result.refused) {
        showToast(t('The model declined to draft that one.', 'El modelo no ha querido redactar esa respuesta.'), 'error')
        return
      }
      await load()
    } catch (e) {
      showToast((e as { statusMessage?: string }).statusMessage ?? t('Could not draft a reply.', 'No se ha podido redactar la respuesta.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  async function approve(reviewId: string, body?: string) {
    busyId.value = reviewId
    try {
      await useStaffFetch(`/api/growth/reputation/${reviewId}/reply`, { method: 'POST', body: { body } })
      // Deliberately not "Posted": nothing reaches Google until the platform
      // integration exists, and a toast that says otherwise would be the
      // easiest possible thing to believe.
      showToast(t('Reply approved and saved.', 'Respuesta aprobada y guardada.'))
      await load()
    } catch (e) {
      showToast((e as { statusMessage?: string }).statusMessage ?? t('Could not save that reply.', 'No se ha podido guardar la respuesta.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  async function discard(reviewId: string) {
    busyId.value = reviewId
    try {
      await useStaffFetch(`/api/growth/reputation/${reviewId}/reply`, { method: 'POST', body: { discard: true } })
      showToast(t('Draft discarded. Nothing was saved.', 'Borrador descartado. No se ha guardado nada.'))
      await load()
    } catch {
      showToast(t('Could not discard that draft.', 'No se ha podido descartar el borrador.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  return { data, loading, error, busyId, draftReply, approve, discard, reload: load }
}
