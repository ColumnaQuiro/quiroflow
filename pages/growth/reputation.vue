<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { data, loading, error, busyId, draftReply, approve, discard, googleLocations, googleBusy, connectGoogle, loadGoogleLocations, chooseGoogleLocation, syncGoogle, disconnectGoogle } = useGrowthReputation()
const route = useRoute()
const { showToast } = useToast()

const allowed = computed(() => can('communication_config'))

const maxBucket = computed(() => Math.max(...(data.value?.distribution.map((b) => b.count) ?? [1]), 1))

// Which stretch of the record the trend draws. Twelve months by default: the
// question it answers is usually "how are we doing lately", and the whole
// history of an older listing flattens the last year into its tail.
type TrendRange = '12' | '24' | 'all'
const trendRange = ref<TrendRange>('12')
const TREND_RANGES = computed<{ key: TrendRange; label: string }[]>(() => [
  { key: '12', label: t('12 months', '12 meses') },
  { key: '24', label: t('2 years', '2 años') },
  { key: 'all', label: t('All', 'Todo') },
])
const visibleTrend = computed(() => {
  const points = data.value?.trend ?? []
  if (trendRange.value === 'all') return points
  const from = new Date()
  from.setUTCMonth(from.getUTCMonth() - Number(trendRange.value) + 1, 1)
  const cutoff = from.toISOString().slice(0, 7)
  return points.filter((p) => p.month >= cutoff)
})
// One decimal, matching the headline rating. `4 → 4` next to `4.3` reads like
// a different quantity.
const trendLabel = computed(() => {
  const points = visibleTrend.value
  return points.length >= 2 ? `${points[0]!.value.toFixed(1)} → ${points[points.length - 1]!.value.toFixed(1)}` : null
})

// Scaled to the range the ratings actually span. On a fixed 0-5 axis a year
// of movement between 4.5 and 4.8 is a flat line, which is the one thing the
// chart exists to disprove.
const trendPath = computed(() => {
  const points = visibleTrend.value
  if (points.length < 2) return ''
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const step = 520 / (points.length - 1)
  return points.map((p, i) => `${Math.round(i * step)},${(66 - ((p.value - min) / span) * 52).toFixed(1)}`).join(' ')
})

// Back from Google's consent screen: choose the listing, or say what went wrong.
// Once the page has loaded, a connected listing is brought up to date.
const googleOutcome = String(route.query.google ?? '')
watch(
  () => data.value?.google,
  (google, before) => {
    if (!google || before) return
    if (googleOutcome === 'choose') loadGoogleLocations()
    else if (google.location) syncGoogle()
  },
)
onMounted(() => {
  const problems: Record<string, string> = {
    declined: t('Google was not connected: the permission was declined.', 'No se ha conectado Google: se rechazó el permiso.'),
    expired: t('That took too long. Connect Google again.', 'Ha tardado demasiado. Vuelve a conectar Google.'),
    failed: t('Google did not complete the connection. Try again.', 'Google no completó la conexión. Inténtalo de nuevo.'),
  }
  if (problems[googleOutcome]) showToast(problems[googleOutcome]!, 'error', 8000)
})

// The list grows twenty at a time: a listing with years of reviews would
// otherwise render hundreds of cards before the page could be read.
const PAGE = 20
const visibleCount = ref(PAGE)
const shownReviews = computed(() => (data.value?.reviews ?? []).slice(0, visibleCount.value))

function when(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <PageHeader
    :title="t('Reputation', 'Reputación')"
    :meta="t('Reviews, and the requests that ask for them', 'Reseñas y las solicitudes que las piden')"
  />

  <div class="flex-1 overflow-y-auto">
    <div class="p-4 sm:p-6">
      <div v-if="!allowed" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t("You don't have access to Growth.", 'No tienes acceso a Crecimiento.') }}</p>
      </div>

      <div v-else-if="resolved && !hasGrowth" class="mx-auto max-w-sm py-16 text-center">
        <p class="text-[13px] text-ink-muted">{{ t('Reputation is part of the Growth tier.', 'Reputación forma parte del plan Growth.') }}</p>
        <NuxtLink to="/growth" class="mt-3 inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-brand-on hover:bg-brand-hover">
          {{ t('See what Growth adds', 'Ver qué añade Growth') }}
        </NuxtLink>
      </div>

      <p v-else-if="error" class="py-16 text-center text-[13px] text-danger-text" data-test="reputation-error">{{ error }}</p>

      <div v-else-if="loading || !data" class="grid animate-pulse gap-4 xl:grid-cols-[minmax(0,1fr)_300px]" aria-hidden="true">
        <div class="h-[500px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[300px] rounded-card border border-line bg-surface shadow-card" />
      </div>

      <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div class="flex flex-col gap-4">
          <!-- No reviews is a missing integration, not a bad score. Saying
          "0.0 out of 5" here would be the single most misleading number this
          screen could show. -->
          <!-- Two different nothings, and they must not look the same.
          Without a Places key on the deployment, importing is not possible
          at all -- so this says "coming soon" rather than offering a button
          that answers "not configured on this deployment", which reads as a
          bug to anybody being shown the product. With a key, it is an
          invitation to connect. -->
          <!-- Google, once this deployment can connect it: where it stands, and the next step. -->
          <section v-if="data.google?.configured" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" data-test="google-reviews">
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Google reviews', 'Reseñas de Google') }}</h2>
                <p v-if="data.google.location" class="text-[12px] text-ink-muted" data-test="google-connected">
                  {{ data.google.locationTitle }}<template v-if="data.google.syncedAt"> · {{ t('updated', 'actualizado') }} {{ when(data.google.syncedAt) }}</template>
                </p>
                <p v-else class="text-[12px] leading-snug text-ink-muted">
                  {{ t('Connect your Google Business Profile: your reviews appear here, a reply is drafted for each, and the one you approve is published on Google.', 'Conecta tu perfil de Google Business: tus reseñas aparecen aquí, se redacta una respuesta para cada una y la que apruebes se publica en Google.') }}
                </p>
              </div>
              <template v-if="data.google.location">
                <UiBtn variant="secondary" size="sm" :disabled="googleBusy" data-test="google-refresh" @click="syncGoogle(true)">{{ t('Refresh', 'Actualizar') }}</UiBtn>
                <UiBtn variant="secondary" size="sm" :disabled="googleBusy" data-test="google-disconnect" @click="disconnectGoogle">{{ t('Disconnect', 'Desconectar') }}</UiBtn>
              </template>
              <UiBtn v-else variant="primary" size="sm" :disabled="googleBusy" data-test="google-connect" @click="connectGoogle">{{ t('Connect Google', 'Conectar Google') }}</UiBtn>
            </div>
            <div v-if="googleLocations" class="flex flex-col gap-2 border-t border-line-divider pt-3" data-test="google-locations">
              <strong class="text-[12.5px] text-ink-900">{{ t('Which listing is this clinic’s?', '¿Cuál es la ficha de esta clínica?') }}</strong>
              <p v-if="googleLocations.length === 0" class="text-[12px] text-ink-muted">{{ t('This Google account manages no listings. Connect with the account that owns the clinic’s profile.', 'Esta cuenta de Google no gestiona ninguna ficha. Conecta con la cuenta propietaria del perfil de la clínica.') }}</p>
              <!-- Not a UiBtn: that one is a single nowrap line, and a listing's
                   title is whatever the owner typed into Google -- often a
                   string of keywords long enough to run out of the card. -->
              <button
                v-for="l in googleLocations"
                :key="l.location"
                type="button"
                class="flex min-h-8 w-full flex-wrap items-baseline gap-x-1 rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-left text-[12.5px] font-medium text-ink-500 hover:border-line-controlHover focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-10"
                :disabled="googleBusy"
                @click="chooseGoogleLocation(l.location)"
              >
                <span class="min-w-0 break-words">{{ l.title }}</span><span v-if="l.address" class="font-normal text-ink-muted">· {{ l.address }}</span>
              </button>
            </div>
          </section>

          <UiEmptyState
            v-if="!data.hasReviews && !data.google?.configured"
            data-test="reviews-coming-soon"
            :eyebrow="t('Coming soon', 'Próximamente')"
            tone="soon"
            :title="t('Ratings and reviews', 'Valoraciones y reseñas')"
            :description="t(
              'Your Google rating and recent reviews will appear here, with a reply drafted for you to approve. The review request funnel below is already running.',
              'Tu valoración de Google y las reseñas recientes aparecerán aquí, con una respuesta redactada para que la apruebes. El embudo de solicitudes de abajo ya está funcionando.',
            )"
          >
            <template #icon>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 2.6l2.1 4.6 5 .6-3.7 3.4 1 4.9L10 13.7l-4.4 2.4 1-4.9L2.9 7.8l5-.6L10 2.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
              </svg>
            </template>
          </UiEmptyState>

          <section v-if="data.hasReviews" class="grid gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[150px_170px_minmax(0,1fr)]">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-ink-muted">{{ t('Average rating', 'Valoración media') }}</span>
              <div class="flex items-baseline gap-1">
                <span class="text-[32px] font-semibold leading-none tracking-tightTitle text-ink-900" data-test="rating">{{ data.rating }}</span>
                <span class="text-[13px] text-ink-muted">/ 5</span>
              </div>
              <GrowthStarRating v-if="data.rating" :rating="data.rating" :size="13" />
              <span class="text-[11px] text-ink-faint" data-test="review-count">{{ data.reviewCount }} {{ t('reviews', 'reseñas') }}<template v-if="data.ratingFromGoogle"> · {{ t('on Google', 'en Google') }}</template></span>
            </div>

            <div class="flex flex-col justify-center gap-1">
              <div v-for="bucket in data.distribution" :key="bucket.stars" class="flex items-center gap-1.5">
                <span class="w-2 text-right text-[11px] text-ink-faint">{{ bucket.stars }}</span>
                <span class="h-1.5 flex-1 overflow-hidden rounded-pill bg-line-divider">
                  <span class="block h-full rounded-pill bg-warning-accent" :style="{ width: `${(bucket.count / maxBucket) * 100}%` }" />
                </span>
                <span class="w-7 text-right font-mono text-[11px] text-ink-muted">{{ bucket.count }}</span>
              </div>
            </div>

            <div v-if="data.trend.length >= 2" class="flex flex-col gap-1 sm:col-span-2 lg:col-span-1" data-test="trend">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <span class="text-[11px] text-ink-muted">{{ t('Trend', 'Tendencia') }}</span>
                <span class="flex items-center gap-1" role="group" :aria-label="t('Trend period', 'Periodo de la tendencia')">
                  <button
                    v-for="range in TREND_RANGES"
                    :key="range.key"
                    type="button"
                    class="rounded-pill px-2 py-0.5 text-[11px] font-medium"
                    :class="trendRange === range.key ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:bg-surface-subtle'"
                    :aria-pressed="trendRange === range.key"
                    :data-test="`trend-range-${range.key}`"
                    @click="trendRange = range.key"
                  >{{ range.label }}</button>
                </span>
              </div>
              <template v-if="visibleTrend.length >= 2">
                <span class="text-[11px] font-semibold text-ink-700">{{ trendLabel }}</span>
                <svg viewBox="0 0 520 74" preserveAspectRatio="none" class="h-[74px] w-full" role="img" :aria-label="t('Rating over time', 'Valoración a lo largo del tiempo')">
                  <line x1="0" y1="66" x2="520" y2="66" class="stroke-line-divider" stroke-width="1" />
                  <polyline :points="trendPath" fill="none" class="stroke-brand" stroke-width="2" vector-effect="non-scaling-stroke" />
                </svg>
                <div class="flex justify-between text-[11px] text-ink-faint">
                  <span>{{ visibleTrend[0]!.label }}</span>
                  <span>{{ visibleTrend[visibleTrend.length - 1]!.label }}</span>
                </div>
              </template>
              <p v-else class="py-4 text-[11.5px] text-ink-muted">{{ t('Not enough reviews in this period to draw a trend.', 'No hay reseñas suficientes en este periodo para dibujar una tendencia.') }}</p>
            </div>
          </section>

          <section v-if="data.hasReviews" class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Reviews', 'Reseñas') }}</h2>
              <span v-if="data.pendingCount" class="rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning-text">
                {{ t('Needs approval', 'Requiere aprobación') }} · {{ data.pendingCount }}
              </span>
            </div>

            <article
              v-for="review in shownReviews"
              :key="review.id"
              class="overflow-hidden rounded-card border bg-surface shadow-card"
              :class="review.draftBody && !review.repliedAt ? 'border-brand-tintBorder' : 'border-line'"
              data-test="review-card"
            >
              <div class="flex flex-col gap-1.5 p-4">
                <div class="flex flex-wrap items-center gap-2">
                  <GrowthStarRating :rating="review.rating" />
                  <span class="text-[12.5px] font-semibold text-ink-900">{{ review.author }}</span>
                  <span class="text-[11px] capitalize text-ink-muted">
                    {{ review.platform }}<template v-if="review.location"> · {{ review.location }}</template>
                  </span>
                  <span class="ml-auto text-[11px] text-ink-faint">{{ when(review.postedAt) }}</span>
                </div>
                <p v-if="review.body" class="text-[12.5px] leading-[1.5] text-ink-700">{{ review.body }}</p>

                <div v-if="review.repliedAt" class="mt-1 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
                  <span class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint">
                    {{ review.replyWasAiDrafted ? t('Replied · AI drafted, approved', 'Respondido · redactado por IA, aprobado') : t('Replied', 'Respondido') }}
                  </span>
                  <p class="mt-1 text-[12px] leading-[1.5] text-ink-700">{{ review.replyBody }}</p>
                </div>

                <div v-else-if="!review.draftBody" class="mt-1">
                  <UiBtn variant="secondary" size="sm" :disabled="busyId === review.id" data-test="draft-reply" @click="draftReply(review.id)">
                    {{ busyId === review.id ? t('Drafting…', 'Redactando…') : t('Draft a reply with AI', 'Redactar respuesta con IA') }}
                  </UiBtn>
                </div>
              </div>

              <GrowthPendingReplyCard
                v-if="review.draftBody && !review.repliedAt"
                :review="review"
                :busy="busyId === review.id"
                @approve="(body) => approve(review.id, body)"
                @discard="discard(review.id)"
              />
            </article>

            <UiBtn
              v-if="data.reviews.length > shownReviews.length"
              variant="secondary"
              size="sm"
              class="self-center"
              data-test="reviews-more"
              @click="visibleCount += PAGE"
            >
              {{ t(`Show more (${data.reviews.length - shownReviews.length} left)`, `Ver más (quedan ${data.reviews.length - shownReviews.length})`) }}
            </UiBtn>
          </section>
        </div>

        <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" data-test="request-funnel">
          <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Review requests', 'Solicitudes de reseña') }}</h2>

          <div class="flex flex-col gap-2">
            <div class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11.5px] text-ink-muted">{{ t('Sent', 'Enviadas') }}</span>
                <span class="text-[12px] font-semibold text-ink-900">{{ data.funnel.sent }}</span>
              </div>
              <span class="h-1.5 overflow-hidden rounded-pill bg-line-divider"><span class="block h-full rounded-pill bg-brand" style="width: 100%" /></span>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11.5px] text-ink-muted">{{ t('Opened the link', 'Abrieron el enlace') }}</span>
                <span class="text-[12px] font-semibold text-ink-900">
                  {{ data.funnel.opened }}<span v-if="data.funnel.openedShare !== null" class="ml-1 text-[11px] font-normal text-ink-muted">{{ data.funnel.openedShare }}%</span>
                </span>
              </div>
              <span class="h-1.5 overflow-hidden rounded-pill bg-line-divider">
                <span class="block h-full rounded-pill bg-brand/70" :style="{ width: `${data.funnel.sent ? (data.funnel.opened / data.funnel.sent) * 100 : 0}%` }" />
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11.5px] text-ink-muted">{{ t('Left a review', 'Dejaron reseña') }}</span>
                <span class="text-[12px] font-semibold" :class="data.funnel.convertedShare === null ? 'text-ink-faint' : 'text-ink-900'">
                  {{ data.funnel.convertedShare === null ? '—' : data.funnel.converted
                  }}<span v-if="data.funnel.convertedShare !== null" class="ml-1 text-[11px] font-normal text-ink-muted">{{ data.funnel.convertedShare }}%</span>
                </span>
              </div>
              <span class="h-1.5 overflow-hidden rounded-pill bg-line-divider">
                <span class="block h-full rounded-pill bg-brand/40" :style="{ width: `${data.funnel.sent ? (data.funnel.converted / data.funnel.sent) * 100 : 0}%` }" />
              </span>
            </div>
          </div>

          <!-- The honest gap in the funnel, named. We can see the link open
          because it goes through us; nobody can watch someone type on Google. -->
          <p class="border-t border-line-divider pt-3 text-[11px] leading-[1.5] text-ink-muted" data-test="funnel-caveat">
            {{ t(
              'Sent and opened are counted here, because the link goes through QuiroFlow. Whether someone then left a review is only known once a platform is connected.',
              'Enviadas y abiertas se cuentan aquí, porque el enlace pasa por QuiroFlow. Si luego dejaron reseña solo se sabe al conectar una plataforma.',
            ) }}
          </p>
        </section>
      </div>

      <GrowthSatisfactionPanel v-if="allowed && resolved && hasGrowth && data" class="mt-4" />
    </div>
  </div>
</template>
