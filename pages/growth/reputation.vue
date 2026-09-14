<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { data, loading, error, busyId, draftReply, approve, discard } = useGrowthReputation()

const allowed = computed(() => can('communication_config'))

const maxBucket = computed(() => Math.max(...(data.value?.distribution.map((b) => b.count) ?? [1]), 1))

// Scaled to the range the ratings actually span. On a fixed 0-5 axis a year
// of movement between 4.5 and 4.8 is a flat line, which is the one thing the
// chart exists to disprove.
const trendPath = computed(() => {
  const points = data.value?.trend ?? []
  if (points.length < 2) return ''
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const step = 520 / (points.length - 1)
  return points.map((p, i) => `${Math.round(i * step)},${(66 - ((p.value - min) / span) * 52).toFixed(1)}`).join(' ')
})

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
        <NuxtLink to="/growth" class="mt-3 inline-flex h-9 items-center rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
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
          <section v-if="!data.hasReviews" class="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card" data-test="no-reviews">
            <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('No reviews here yet', 'Aún no hay reseñas aquí') }}</h2>
            <p class="max-w-[62ch] text-[12px] leading-[1.6] text-ink-muted">
              {{ t(
                'Ratings and review text live inside Google, Doctoralia and Facebook. Connecting them needs an integration per platform, which is not built yet — so this stays empty rather than showing a rating nobody gave you. The request funnel is already counting.',
                'Las valoraciones y el texto de las reseñas están dentro de Google, Doctoralia y Facebook. Conectarlos requiere una integración por plataforma, que aún no está construida, así que esto queda vacío en lugar de mostrar una valoración que nadie te ha dado. El embudo de solicitudes ya está contando.',
              ) }}
            </p>
          </section>

          <section v-else class="grid gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[150px_170px_minmax(0,1fr)]">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-ink-muted">{{ t('Average rating', 'Valoración media') }}</span>
              <div class="flex items-baseline gap-1">
                <span class="text-[32px] font-semibold leading-none tracking-tightTitle text-ink-900" data-test="rating">{{ data.rating }}</span>
                <span class="text-[13px] text-ink-muted">/ 5</span>
              </div>
              <GrowthStarRating v-if="data.rating" :rating="data.rating" :size="13" />
              <span class="text-[10.5px] text-ink-faint">{{ data.reviewCount }} {{ t('reviews', 'reseñas') }}</span>
            </div>

            <div class="flex flex-col justify-center gap-1">
              <div v-for="bucket in data.distribution" :key="bucket.stars" class="flex items-center gap-1.5">
                <span class="w-2 text-right text-[10px] text-ink-faint">{{ bucket.stars }}</span>
                <span class="h-1.5 flex-1 overflow-hidden rounded-pill bg-line-divider">
                  <span class="block h-full rounded-pill bg-warning-accent" :style="{ width: `${(bucket.count / maxBucket) * 100}%` }" />
                </span>
                <span class="w-7 text-right font-mono text-[10px] text-ink-muted">{{ bucket.count }}</span>
              </div>
            </div>

            <div v-if="data.trend.length >= 2" class="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11px] text-ink-muted">{{ t('Trend', 'Tendencia') }}</span>
                <span class="text-[11px] font-semibold text-ink-700">{{ data.trendLabel }}</span>
              </div>
              <svg viewBox="0 0 520 74" preserveAspectRatio="none" class="h-[74px] w-full" role="img" :aria-label="t('Rating over time', 'Valoración a lo largo del tiempo')">
                <line x1="0" y1="66" x2="520" y2="66" class="stroke-line-divider" stroke-width="1" />
                <polyline :points="trendPath" fill="none" class="stroke-brand" stroke-width="2" vector-effect="non-scaling-stroke" />
              </svg>
              <div class="flex justify-between text-[10px] text-ink-faint">
                <span>{{ data.trend[0]!.label }}</span>
                <span>{{ data.trend[data.trend.length - 1]!.label }}</span>
              </div>
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
              v-for="review in data.reviews"
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
                  <span class="ml-auto text-[10.5px] text-ink-faint">{{ when(review.postedAt) }}</span>
                </div>
                <p v-if="review.body" class="text-[12.5px] leading-[1.5] text-ink-700">{{ review.body }}</p>

                <div v-if="review.repliedAt" class="mt-1 rounded-ctl border border-line bg-surface-subtle px-3 py-2">
                  <span class="text-[10.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">
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
                  {{ data.funnel.opened }}<span v-if="data.funnel.openedShare !== null" class="ml-1 text-[10.5px] font-normal text-ink-muted">{{ data.funnel.openedShare }}%</span>
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
                  }}<span v-if="data.funnel.convertedShare !== null" class="ml-1 text-[10.5px] font-normal text-ink-muted">{{ data.funnel.convertedShare }}%</span>
                </span>
              </div>
              <span class="h-1.5 overflow-hidden rounded-pill bg-line-divider">
                <span class="block h-full rounded-pill bg-brand/40" :style="{ width: `${data.funnel.sent ? (data.funnel.converted / data.funnel.sent) * 100 : 0}%` }" />
              </span>
            </div>
          </div>

          <!-- The honest gap in the funnel, named. We can see the link open
          because it goes through us; nobody can watch someone type on Google. -->
          <p class="border-t border-line-divider pt-3 text-[10.5px] leading-[1.5] text-ink-muted" data-test="funnel-caveat">
            {{ t(
              'Sent and opened are counted here, because the link goes through QuiroFlow. Whether someone then left a review is only known once a platform is connected.',
              'Enviadas y abiertas se cuentan aquí, porque el enlace pasa por QuiroFlow. Si luego dejaron reseña solo se sabe al conectar una plataforma.',
            ) }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
