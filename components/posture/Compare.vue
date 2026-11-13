<script setup lang="ts">
import type { PostureView, ViewMetrics } from '../../utils/posture'
import { COMPARE_GROUPS, COMPARE_METRICS, compareBar, compareHighlights, comparePosture, type CompareAudience, type CompareGroup, type CompareRow } from '../../utils/postureCompare'

// Two posture assessments, measure by measure: what each number was, what it
// is now, where both sit against aligned, and whether that is better -- said
// in words as well as in colour. The record shows every measure, grouped
// (components/posture/Section.vue); the patient sees the four their chart
// explains, in their own words (components/patient/PostureProgress.vue). The
// arithmetic is utils/postureCompare.ts, which the comparison PDF reads too;
// the words are said here through t(), so they follow the interface language
// (the PDF's follow the patient's).
// Shared with mobile/, so its imports are relative.
const props = withDefaults(
  defineProps<{
    before: Partial<Record<PostureView, ViewMetrics>>
    after: Partial<Record<PostureView, ViewMetrics>>
    beforeAt: string
    afterAt: string
    audience?: CompareAudience
  }>(),
  { audience: 'staff' },
)

const t = useT()
const locale = computed(() => t('en-GB', 'es-ES'))
// Which rows there are does not depend on the language; their labels are read below.
const comparison = computed(() => comparePosture(props.before, props.after, 'en', props.audience))
const label = (r: CompareRow) => {
  const m = COMPARE_METRICS.find((x) => x.key === r.key)!
  const pair = props.audience === 'patient' ? m.plain : m.label
  return t(pair.en, pair.es)
}
const groups = computed(() => {
  const order: CompareGroup[] = ['head', 'side', 'front']
  // The patient's four need no headings.
  if (props.audience === 'patient') return [{ key: 'all', title: '', rows: comparison.value.rows }]
  return order.map((g) => ({ key: g, title: t(COMPARE_GROUPS[g].en, COMPARE_GROUPS[g].es), rows: comparison.value.rows.filter((r) => r.group === g) })).filter((g) => g.rows.length)
})
const tone = computed(() => (comparison.value.better ? 'better' : comparison.value.worse ? 'worse' : 'same'))

const shortDay = (iso: string) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
const value = (n: number, unit: string) => `${(Math.round(n * 10) / 10 || 0).toLocaleString(locale.value, { maximumFractionDigits: 1 })}${unit === '°' ? '°' : ` ${unit}`}`
const delta = (r: CompareRow) => `${r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}${value(Math.abs(r.delta), r.unit)}`
const verdictLabel = (r: CompareRow) =>
  r.verdict === 'better' ? (props.audience === 'patient' ? t("You're improving", 'Vas mejor') : t('Better', 'Mejora')) : r.verdict === 'worse' ? t('To watch', 'A vigilar') : t('Same', 'Igual')

// A label inside a sentence: lower case, except in German, whose nouns keep their capital.
const inline = (r: CompareRow) => (locale.value.startsWith('de') ? label(r) : label(r).toLowerCase())

// The same summary as the PDF's compareHeadline and compareSentence.
const headline = computed(() => {
  const c = comparison.value
  const n = c.rows.length
  if (!n) return t('These two assessments share no view to compare.', 'Estas dos valoraciones no tienen fotos de la misma vista que comparar.')
  if (c.better) return c.better === 1 ? t(`1 of ${n} measurements improved`, `1 de ${n} medidas mejora`) : t(`${c.better} of ${n} measurements improved`, `${c.better} de ${n} medidas mejoran`)
  if (c.worse) return t(`${c.worse} of ${n} measurements to watch`, `${c.worse} de ${n} medidas a vigilar`)
  return t('The measurements are much the same', 'Las medidas se mantienen parecidas')
})
const sentence = computed(() => {
  const c = comparison.value
  if (!c.rows.length) return ''
  const h = compareHighlights(c)
  const list = (rows: CompareRow[]) =>
    new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' }).format(
      rows.map((r) => t(`${inline(r)} (from ${value(r.before, r.unit)} to ${value(r.after, r.unit)})`, `${inline(r)} (de ${value(r.before, r.unit)} a ${value(r.after, r.unit)})`)),
    )
  const out: string[] = []
  if (h.better.length) out.push(t(`What improved most: ${list(h.better)}.`, `Lo que más ha mejorado: ${list(h.better)}.`))
  if (h.worse.length) out.push(t(`To watch: ${list(h.worse)}.`, `A vigilar: ${list(h.worse)}.`))
  if (!h.better.length && !h.worse.length) out.push(t('The measurements are much the same in both assessments.', 'Las medidas se mantienen parecidas entre las dos valoraciones.'))
  else if (h.same) out.push(h.same === 1 ? t('The other measurement is much the same.', 'La otra medida se mantiene parecida.') : t('The rest is much the same.', 'El resto se mantiene parecido.'))
  return out.join(' ')
})
const pct = (f: number) => `${(f * 100).toFixed(1)}%`
function bar(r: CompareRow) {
  const b = compareBar(r)
  return { ...b, from: Math.min(b.before, b.after), width: Math.abs(b.after - b.before) }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-cy="posture-comparison" :data-better="comparison.better" :data-worse="comparison.worse" :data-same="comparison.same">
    <div
      class="rounded-ctl border p-3.5"
      :class="tone === 'better' ? 'border-success-border bg-success-bg' : tone === 'worse' ? 'border-warning-border bg-warning-bg' : 'border-line bg-surface-subtle'"
    >
      <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-700">{{ t(`Compared: ${shortDay(beforeAt)} and ${shortDay(afterAt)}`, `Comparadas: ${shortDay(beforeAt)} y ${shortDay(afterAt)}`) }}</p>
      <p class="mt-1 text-[17px] font-semibold text-ink-900" data-cy="posture-comparison-headline">{{ headline }}</p>
      <p v-if="sentence" class="mt-1 text-[13px] leading-relaxed text-ink-700" data-cy="posture-comparison-sentence">{{ sentence }}</p>
    </div>

    <div v-for="g in groups" :key="g.key" class="flex flex-col">
      <p v-if="g.title" class="pb-1 text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ g.title }}</p>
      <ul class="flex flex-col divide-y divide-line-divider">
        <li v-for="r in g.rows" :key="r.key" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" :data-cy="`posture-comparison-row-${r.key}`" :data-verdict="r.verdict">
          <p class="w-full min-w-0 text-[13.5px] font-semibold text-ink-900 sm:w-auto sm:flex-1">{{ label(r) }}</p>
          <span
            class="shrink-0 rounded-pill px-2.5 py-0.5 text-[12.5px] font-semibold"
            :class="r.verdict === 'better' ? 'bg-success-bg text-success-text' : r.verdict === 'worse' ? 'bg-warning-bg text-warning-text' : 'bg-surface-subtle text-ink-700'"
          >{{ r.verdict === 'same' ? verdictLabel(r) : `${delta(r)} · ${verdictLabel(r)}` }}</span>
          <div class="flex w-full items-center gap-3">
            <span class="w-[68px] shrink-0 text-right font-mono text-[12.5px] text-ink-muted">{{ value(r.before, r.unit) }}</span>
            <!-- Aligned is the green tick; the hollow dot is before, the full one now. -->
            <div class="relative h-4 min-w-0 flex-1" aria-hidden="true">
              <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-surface-subtle" />
              <div class="absolute top-1/2 h-1 -translate-y-1/2 rounded-pill" :class="r.verdict === 'better' ? 'bg-success-text' : r.verdict === 'worse' ? 'bg-warning-text' : 'bg-ink-muted'" :style="{ left: pct(bar(r).from), width: pct(bar(r).width) }" />
              <div class="absolute top-0 h-4 w-0.5 -translate-x-1/2 bg-success-text" :style="{ left: pct(bar(r).ideal) }" />
              <div class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-muted bg-surface" :style="{ left: pct(bar(r).before) }" />
              <div class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" :class="r.verdict === 'better' ? 'bg-success-text' : r.verdict === 'worse' ? 'bg-warning-text' : 'bg-ink-700'" :style="{ left: pct(bar(r).after) }" />
            </div>
            <span class="w-[68px] shrink-0 font-mono text-[13px] font-semibold text-ink-900">{{ value(r.after, r.unit) }}</span>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="comparison.rows.length" class="text-[12px] text-ink-muted">
      {{ t(`On each bar: hollow dot, ${shortDay(beforeAt)}; full dot, ${shortDay(afterAt)}; green mark, aligned. The closer to the mark, the better.`, `En cada barra: punto hueco, ${shortDay(beforeAt)}; punto lleno, ${shortDay(afterAt)}; marca verde, lo alineado. Cuanto más cerca de la marca, mejor.`) }}
    </p>
  </div>
</template>
