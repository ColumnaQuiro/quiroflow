<script setup lang="ts">
// Números's income as a curve on the back plane: money taken so far this
// period, day by day, with the same stretch of the period before as a dashed
// line to measure it against. Drawn from the very payments the figure above
// it adds up (components/dashboard/IncomeMiniWidget.vue emits them), so the
// curve always ends on that figure.
//
// Cumulative rather than per day: a clinic's takings arrive in lumps (a bono,
// a quiet Monday) and a daily bar chart of them is mostly noise; the running
// total shows whether the period is ahead of the last one, which is the
// question the screen is opened with.
const props = defineProps<{
  series: {
    from: string
    to: string
    prevFrom: string
    current: { at: string; cents: number }[]
    previous: { at: string; cents: number }[]
  } | null
}>()
const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))

const W = 340
const H = 110
const DAY = 86_400_000

const model = computed(() => {
  const s = props.series
  if (!s) return null
  const from = new Date(s.from).getTime()
  const to = new Date(s.to).getTime()
  const prevFrom = new Date(s.prevFrom).getTime()
  const days = Math.max(1, Math.ceil((to - from) / DAY))
  // Up to today: the rest of the period has not happened yet, and a line
  // running flat to the month's end would read as takings stopping.
  const shownDays = Math.max(1, Math.min(days, Math.ceil((Date.now() - from) / DAY)))

  const cumulative = (rows: { at: string; cents: number }[], start: number, upTo: number) => {
    const perDay = Array.from({ length: upTo }, () => 0)
    for (const r of rows) {
      const i = Math.floor((new Date(r.at).getTime() - start) / DAY)
      if (i >= 0 && i < upTo) perDay[i]! += r.cents
    }
    let run = 0
    return perDay.map((c) => (run += c))
  }
  const now = cumulative(s.current, from, shownDays)
  const before = cumulative(s.previous, prevFrom, days)
  const top = Math.max(1, ...now, ...before)

  const x = (i: number) => (days === 1 ? W : (W * i) / (days - 1))
  const y = (cents: number) => H - 6 - ((H - 12) * cents) / top
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const nowPath = line(now)
  const lastX = x(now.length - 1)
  return {
    nowPath,
    area: `${nowPath} L${lastX.toFixed(1)} ${H} L0 ${H} Z`,
    beforePath: line(before),
    end: { x: lastX, y: y(now[now.length - 1] ?? 0) },
    startLabel: new Date(from).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' }),
    single: days === 1,
  }
})
</script>

<template>
  <div v-if="model && !model.single" data-cy="numbers-income-curve">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="block h-[110px] w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      :aria-label="t('Money taken so far this period, day by day; the dashed line is the same stretch of the period before.', 'Lo cobrado en el periodo, día a día; la línea discontinua es el mismo tramo del periodo anterior.')"
    >
      <path :d="model.area" class="fill-ink-900/[.12]" />
      <path :d="model.beforePath" fill="none" class="stroke-ink-muted" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      <path :d="model.nowPath" fill="none" class="stroke-ink-900" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="mt-1 flex justify-between text-[12.5px] text-ink-muted">
      <span>{{ model.startLabel }}</span>
      <span class="flex items-center gap-3">
        <span class="flex items-center gap-1.5"><span class="h-[2.5px] w-4 rounded-full bg-ink-900" aria-hidden="true" />{{ t('This period', 'Este periodo') }}</span>
        <span class="flex items-center gap-1.5"><span class="h-0 w-4 border-t-[1.5px] border-dashed border-ink-muted" aria-hidden="true" />{{ t('Before', 'Anterior') }}</span>
      </span>
    </div>
  </div>
</template>
