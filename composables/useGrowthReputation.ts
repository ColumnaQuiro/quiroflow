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
  google: {
    /** Whether this deployment can connect Google at all. */
    configured: boolean
    /** The listing being read ("locations/456"), or null until one is chosen. */
    location: string | null
    locationTitle: string | null
    syncedAt: string | null
  }
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
      showToast(serverMessage(e) ?? t('Could not draft a reply.', 'No se ha podido redactar la respuesta.'), 'error')
    } finally {
      busyId.value = null
    }
  }

  async function approve(reviewId: string, body?: string) {
    busyId.value = reviewId
    try {
      const result = await useStaffFetch<{ postedToPlatform: boolean }>(`/api/growth/reputation/${reviewId}/reply`, { method: 'POST', body: { body } })
      // "Published" only when Google said yes. Anything else is saved here
      // and nowhere else, and the toast must not be the thing that says otherwise.
      showToast(result.postedToPlatform ? t('Reply published on Google.', 'Respuesta publicada en Google.') : t('Reply approved and saved.', 'Respuesta aprobada y guardada.'))
      await load()
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not save that reply.', 'No se ha podido guardar la respuesta.'), 'error')
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


  // Google: connect, choose the listing, and keep its reviews current.
  const googleLocations = ref<{ account: string; location: string; title: string; address: string | null }[] | null>(null)
  const googleBusy = ref(false)

  async function connectGoogle() {
    googleBusy.value = true
    try {
      const { url } = await useStaffFetch<{ url: string }>('/api/google-business/connect')
      window.location.href = url
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not start connecting Google.', 'No se ha podido empezar a conectar Google.'), 'error')
      googleBusy.value = false
    }
  }

  async function loadGoogleLocations() {
    googleBusy.value = true
    try {
      googleLocations.value = (await useStaffFetch<{ locations: NonNullable<typeof googleLocations.value> }>('/api/google-business/locations')).locations
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not read your Google listings.', 'No se han podido leer tus fichas de Google.'), 'error')
    } finally {
      googleBusy.value = false
    }
  }

  async function chooseGoogleLocation(location: string) {
    googleBusy.value = true
    try {
      const result = await useStaffFetch<{ title: string; imported: number; syncError?: string }>('/api/google-business/location', { method: 'POST', body: { location } })
      googleLocations.value = null
      if (result.syncError) showToast(result.syncError, 'error')
      else showToast(t(`Connected to ${result.title}: ${result.imported} reviews imported.`, `Conectado a ${result.title}: ${result.imported} reseñas importadas.`), 'success')
      await load()
    } catch (e) {
      showToast(serverMessage(e) ?? t('Could not choose that listing.', 'No se ha podido elegir esa ficha.'), 'error')
    } finally {
      googleBusy.value = false
    }
  }

  /** Quietly, when the page opens; with a toast when somebody presses Refresh. */
  async function syncGoogle(force = false) {
    if (force) googleBusy.value = true
    try {
      const result = await useStaffFetch<{ synced: boolean; imported: number }>('/api/google-business/sync', { method: 'POST', body: { force } })
      if (result.synced) await load()
      if (force) showToast(t('Google reviews are up to date.', 'Las reseñas de Google están al día.'), 'success')
    } catch (e) {
      if (force) showToast(serverMessage(e) ?? t('Could not read your Google reviews.', 'No se han podido leer tus reseñas de Google.'), 'error')
    } finally {
      googleBusy.value = false
    }
  }

  async function disconnectGoogle() {
    googleBusy.value = true
    try {
      await useStaffFetch('/api/google-business/disconnect', { method: 'POST' })
      googleLocations.value = null
      await load()
    } finally {
      googleBusy.value = false
    }
  }

  return { data, loading, error, busyId, draftReply, approve, discard, reload: load, googleLocations, googleBusy, connectGoogle, loadGoogleLocations, chooseGoogleLocation, syncGoogle, disconnectGoogle }
}
