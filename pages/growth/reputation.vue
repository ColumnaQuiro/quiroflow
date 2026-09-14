<script setup lang="ts">
const t = useT()
const { can } = usePermission()
const { hasGrowth, resolved } = useGrowthTier()
const { data, loading, pendingOutcome, approvePending, discardPending } = useGrowthReputation()

const allowed = computed(() => can('communication_config'))

// The trend line is drawn from the ratings themselves, scaled to whatever
// range they actually span -- a fixed 0-5 axis would flatten a year of
// movement between 4.5 and 4.8 into a straight line.
const trendPath = computed(() => {
  const points = data.value?.trend ?? []
  if (points.length < 2) return ''
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = 520 / (points.length - 1)
  return points
    .map((v, i) => `${Math.round(i * step)},${(66 - ((v - min) / span) * 52).toFixed(1)}`)
    .join(' ')
})

const maxBucket = computed(() => Math.max(...(data.value?.distribution.map((b) => b.count) ?? [1]), 1))
</script>

<template>
  <PageHeader
    :title="t('Reputation', 'Reputación')"
    :meta="t('Reviews across Google, Doctoralia and Facebook · requests sent automatically after each visit', 'Reseñas en Google, Doctoralia y Facebook · solicitudes enviadas automáticamente tras cada visita')"
  >
    <span class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-2.5 text-[12px] text-ink-500">
      {{ t('All locations', 'Todos los centros') }}
    </span>
    <button type="button" class="flex h-8 items-center rounded-ctl bg-brand px-3.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
      {{ t('Request reviews', 'Solicitar reseñas') }}
    </button>
  </PageHeader>

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

      <div v-else-if="!resolved || loading || !data" class="grid animate-pulse gap-4 xl:grid-cols-[minmax(0,1fr)_300px]" aria-hidden="true">
        <div class="h-[600px] rounded-card border border-line bg-surface shadow-card" />
        <div class="h-[420px] rounded-card border border-line bg-surface shadow-card" />
      </div>

      <div v-else class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div class="flex flex-col gap-4">
          <section class="grid gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-[160px_minmax(0,1fr)] lg:grid-cols-[160px_180px_minmax(0,1fr)]">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-ink-muted">{{ t('Google rating', 'Valoración en Google') }}</span>
              <div class="flex items-baseline gap-1">
                <span class="text-[32px] font-semibold leading-none tracking-tightTitle text-ink-900">{{ data.rating }}</span>
                <span class="text-[13px] text-ink-muted">/ 5</span>
              </div>
              <GrowthStarRating :rating="data.rating" :size="13" />
              <span class="text-[10.5px] text-ink-faint">{{ data.reviewCount }} {{ t('reviews', 'reseñas') }} · {{ data.yearDelta }}</span>
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

            <div class="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[11px] text-ink-muted">{{ t('12-month trend', 'Tendencia 12 meses') }}</span>
                <span class="text-[11px] font-semibold text-success-text">{{ data.trendLabel }}</span>
              </div>
              <svg viewBox="0 0 520 74" preserveAspectRatio="none" class="h-[74px] w-full" role="img" :aria-label="t('Rating trend over twelve months', 'Tendencia de la valoración en doce meses')">
                <line x1="0" y1="66" x2="520" y2="66" class="stroke-line-divider" stroke-width="1" />
                <polyline :points="trendPath" fill="none" class="stroke-brand" stroke-width="2" vector-effect="non-scaling-stroke" />
              </svg>
              <div class="flex justify-between text-[10px] text-ink-faint">
                <span v-for="label in data.trendAxis" :key="label">{{ label }}</span>
              </div>
            </div>
          </section>

          <section class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Recent reviews', 'Reseñas recientes') }}</h2>
              <div class="flex items-center gap-2">
                <span class="rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning-text">
                  {{ t('Needs approval', 'Requiere aprobación') }} · {{ data.pendingCount }}
                </span>
                <span class="rounded-pill border border-chip-border bg-chip-bg px-2 py-0.5 text-[11px] text-ink-muted">{{ t('All platforms', 'Todas las plataformas') }}</span>
              </div>
            </div>

            <GrowthPendingReplyCard
              :pending="data.pendingReply"
              :outcome="pendingOutcome"
              @approve="approvePending"
              @discard="discardPending"
            />

            <article
              v-for="review in data.reviews"
              :key="review.id"
              class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4 shadow-card"
              data-test="review-card"
            >
              <div class="flex flex-wrap items-center gap-2">
                <GrowthStarRating :rating="review.rating" />
                <span class="text-[12.5px] font-semibold text-ink-900">{{ review.author }}</span>
                <span class="text-[11px] text-ink-muted">{{ review.platform }} · {{ review.location }}</span>
                <span class="rounded-pill border border-success-border bg-success-bg px-2 py-0.5 text-[10px] font-medium text-success-text">
                  {{ t('Positive', 'Positiva') }}
                </span>
                <span class="ml-auto text-[10.5px] text-ink-faint">{{ review.when }}</span>
              </div>
              <p class="text-[12.5px] leading-[1.5] text-ink-700">{{ review.text }}</p>
              <span class="text-[10.5px] text-ink-faint">{{ review.replyNote }}</span>
            </article>
          </section>
        </div>

        <div class="flex flex-col gap-4">
          <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Review request funnel', 'Embudo de solicitudes') }}</h2>
            <div class="flex flex-col gap-2">
              <div v-for="(step, i) in data.funnel" :key="step.label" class="flex flex-col gap-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="text-[11.5px] text-ink-muted">{{ step.label }}</span>
                  <span class="text-[12px] font-semibold text-ink-900">
                    {{ step.value }}<span v-if="step.share" class="ml-1 text-[10.5px] font-normal text-ink-muted">{{ step.share }}</span>
                  </span>
                </div>
                <span class="h-1.5 overflow-hidden rounded-pill bg-line-divider">
                  <span class="block h-full rounded-pill bg-brand" :style="{ width: `${(step.value / data.funnel[0]!.value) * 100}%`, opacity: 1 - i * 0.25 }" />
                </span>
              </div>
            </div>

            <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
              <span class="text-[10px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Sent by', 'Enviado por') }}</span>
              <div class="flex items-center justify-between gap-2">
                <span class="text-[11.5px] font-medium text-ink-700">{{ data.sendingAutomation.name }}</span>
                <span class="shrink-0 rounded-pill border border-success-border bg-success-bg px-2 py-0.5 text-[10px] font-medium text-success-text">
                  {{ t('Enabled', 'Activo') }}
                </span>
              </div>
              <p class="text-[10.5px] leading-[1.5] text-ink-muted">{{ data.sendingAutomation.detail }}</p>
              <NuxtLink to="/growth/automations" class="text-[11px] font-semibold text-brand-text hover:underline">
                {{ t('Open in Automations', 'Abrir en Automatizaciones') }} →
              </NuxtLink>
            </div>
          </section>

          <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
            <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('By location', 'Por centro') }}</h2>
            <div class="flex flex-col gap-1.5">
              <div v-for="loc in data.byLocation" :key="loc.name" class="flex items-center justify-between gap-2">
                <span class="text-[11.5px] text-ink-700">{{ loc.name }}</span>
                <span class="flex items-center gap-1.5">
                  <GrowthStarRating :rating="loc.rating" :size="10" />
                  <span class="text-[11px] text-ink-muted">{{ loc.rating }} · {{ loc.reviews }}</span>
                </span>
              </div>
            </div>

            <div class="flex flex-col gap-1.5 border-t border-line-divider pt-3">
              <span class="text-[10px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Most mentioned', 'Más mencionado') }}</span>
              <div class="flex flex-wrap gap-1.5">
                <!-- "Waiting time · 9" is the one worth reading, so a negative
                theme is not dressed in the same neutral chip as the praise. -->
                <span
                  v-for="tag in data.mostMentioned"
                  :key="tag.label"
                  class="rounded-pill border px-2 py-0.5 text-[11px]"
                  :class="tag.label === 'Waiting time'
                    ? 'border-warning-border bg-warning-bg text-warning-text'
                    : 'border-chip-border bg-chip-bg text-ink-muted'"
                >{{ tag.label }} · {{ tag.count }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
