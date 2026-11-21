<script setup lang="ts">
import { trendLayout, trendSummary } from '../../utils/postureTrend'
import { squatSuggestions } from '../../utils/postureSuggestions'
import { straighten } from '../../utils/posture'
import {
  measureSquat,
  SQUAT_TREND_METRICS,
  SQUAT_VIEW_LABELS,
  squatCallouts,
  squatHeadline,
  squatPlane,
  squatPxPerCm,
  squatTrendValue,
  type SquatFrontMetrics,
  type SquatMetrics,
  type SquatSideMetrics,
  type SquatTrendKey,
  type SquatView,
  type SquatViews,
} from '../../utils/squat'

// "Sentadilla" on the record's Progreso tab (the second half of Postura's
// switch, components/posture/Section.vue): the patient's squat assessments
// (posture_assessments of kind 'squat', utils/squat.ts). One picked: its
// standing and bottom photos side by side, from the front or the side, and
// every measurement of both. Two picked: the same photo of each, and every
// measurement then and now. The headline numbers, how they have moved over
// every squat, where the weight falls at the bottom, and exercises the
// measurements suggest. A new one is taken on /patients/posture/<id>?kind=squat.
//
// Measured again from the points every time it is shown, like posture, so a
// formula refined later reaches the older ones too. Shared with the staff app.
const props = defineProps<{ patientId: string; can: (permission: string) => boolean }>()

const t = useT()
const supabase = useSupabaseClient()
const { showToast } = useToast()

interface Assessment { id: string; taken_at: string; height_cm: number; views: SquatViews; notes: string | null; team_members: { full_name: string } | null }
const list = ref<Assessment[]>([])
const urls = ref<Record<string, string>>({})
const loading = ref(true)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('posture_assessments')
    .select('id, taken_at, height_cm, views, notes, team_members(full_name)')
    .eq('patient_id', props.patientId)
    .eq('kind', 'squat')
    .order('taken_at')
  list.value = (data as unknown as Assessment[] | null) ?? []
  const paths = list.value.flatMap((a) => Object.values(a.views).map((v) => v!.photo))
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('patient-files').createSignedUrls(paths, 3600)
    urls.value = Object.fromEntries((signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])))
  }
  picked.value = list.value.length ? [list.value[list.value.length - 1]!.id] : []
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

const measured = computed(() => new Map(list.value.map((a) => [a.id, measureSquat(a.views, Number(a.height_cm))])))
const metricsOf = (a: Assessment): SquatMetrics => measured.value.get(a.id) ?? {}

const picked = ref<string[]>([])
function toggle(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value.slice(-1), id]
}
const pair = computed(() => list.value.filter((a) => picked.value.includes(a.id)))
const latest = computed(() => pair.value[pair.value.length - 1] ?? null)
const earlier = computed(() => (pair.value.length === 2 ? pair.value[0]! : null))

const planes = computed(() => {
  const v = latest.value?.views ?? {}
  const out: ('front' | 'side')[] = []
  if (v.front_up || v.front_down) out.push('front')
  if (v.side_up || v.side_down) out.push('side')
  return out
})
const plane = ref<'front' | 'side'>('front')
watch(planes, (ps) => {
  if (ps.length && !ps.includes(plane.value)) plane.value = ps[0]!
}, { immediate: true })

// The photos shown: one session's standing and bottom, or the bottom of two.
const showValues = ref(true)
const photos = computed(() => {
  const a = latest.value
  if (!a) return []
  const pick = (s: Assessment, v: SquatView, caption: string) => {
    const sv = s.views[v]
    if (!sv || !urls.value[sv.photo]) return null
    const up = s.views[`${squatPlane(v)}_up` as SquatView]
    const k = squatPxPerCm(up, squatPlane(v), Number(s.height_cm))
    const callouts = showValues.value ? squatCallouts(v, sv.points, k, sv.facing, sv.tilt ?? null, up ? straighten(up.points, up.tilt ?? null) : null) : null
    return { key: `${s.id}-${v}`, v, src: urls.value[sv.photo]!, sv, caption, callouts }
  }
  const out = earlier.value
    ? [pick(earlier.value, `${plane.value}_down`, day(earlier.value.taken_at)), pick(a, `${plane.value}_down`, day(a.taken_at))]
    : [pick(a, `${plane.value}_up`, t('Standing', 'Arriba')), pick(a, `${plane.value}_down`, t('Bottom', 'Abajo'))]
  return out.filter((p): p is NonNullable<typeof p> => !!p)
})

const head = computed(() => (latest.value ? squatHeadline(metricsOf(latest.value)) : null))
const headBefore = computed(() => (earlier.value ? squatHeadline(metricsOf(earlier.value)) : list.value.length > 1 && latest.value && list.value[0]!.id !== latest.value.id ? squatHeadline(metricsOf(list.value[0]!)) : null))
const beforeAt = computed(() => (earlier.value ?? (list.value.length > 1 ? list.value[0]! : null))?.taken_at ?? null)
const kpis = computed(() => {
  const h = head.value
  if (!h) return []
  const b = headBefore.value
  return [
    { key: 'kneeIn', label: t('Knee caving in (more)', 'Rodilla hacia dentro (la que más)'), unit: '°', now: h.kneeIn, then: b?.kneeIn ?? null, note: h.kneeInR !== null ? t(`R ${num(h.kneeInR)}° · L ${num(h.kneeInL)}°`, `D ${num(h.kneeInR)}° · I ${num(h.kneeInL)}°`) : '' },
    { key: 'depth', label: t('Knee angle at the bottom', 'Ángulo de rodilla abajo'), unit: '°', now: h.depth, then: b?.depth ?? null, note: h.hipBelowKnee === null ? '' : h.hipBelowKnee ? t('hip below the knee', 'cadera por debajo de la rodilla') : t('hip above the knee', 'cadera por encima de la rodilla') },
    { key: 'trunk', label: t('Trunk lean', 'Inclinación del tronco'), unit: '°', now: h.trunkLean, then: b?.trunkLean ?? null, note: h.trunkVsTibia !== null ? t(`${num(h.trunkVsTibia)}° more than the shin`, `${num(h.trunkVsTibia)}° más que la tibia`) : '' },
    { key: 'shift', label: t('Pelvis off centre', 'Desplazamiento lateral'), unit: 'cm', now: h.shift === null ? null : Math.abs(h.shift), then: b?.shift === null || b?.shift === undefined ? null : Math.abs(b.shift), note: h.shift === null || Math.abs(h.shift) < 0.5 ? '' : h.shift > 0 ? t('to the right', 'hacia la derecha') : t('to the left', 'hacia la izquierda') },
  ].filter((k) => k.now !== null)
})
// Lower is the direction a squat improves in, for all four.
const deltaClass = (now: number, then: number) => (Math.abs(now - then) < 0.5 ? 'text-ink-muted' : Math.abs(now) < Math.abs(then) ? 'text-success-text' : 'text-warning-text')

// Every measurement of the photos shown, as a table.
interface Row { label: string; unit: string; values: (number | boolean | null)[] }
const tableCols = computed(() => (earlier.value ? [day(earlier.value.taken_at), day(latest.value!.taken_at)] : [t('Standing', 'Arriba'), t('Bottom', 'Abajo')]))
const frontRows = computed<Row[]>(() => {
  const a = latest.value
  if (!a) return []
  const cols = earlier.value ? [metricsOf(earlier.value).front_down, metricsOf(a).front_down] : [metricsOf(a).front_up, metricsOf(a).front_down]
  if (!cols.some(Boolean)) return []
  const v = (f: (m: SquatFrontMetrics) => number | null) => cols.map((m) => (m ? f(m) : null))
  return [
    { label: t('Right knee inward', 'Rodilla derecha hacia dentro'), unit: '°', values: v((m) => m.kneeInR) },
    { label: t('Left knee inward', 'Rodilla izquierda hacia dentro'), unit: '°', values: v((m) => m.kneeInL) },
    { label: t('Pelvis tilted', 'Pelvis inclinada'), unit: '°', values: v((m) => m.pelvisTilt) },
    { label: t('Pelvis off centre', 'Desplazamiento lateral'), unit: 'cm', values: v((m) => m.shiftCm) },
    { label: t('Shoulders', 'Hombros'), unit: '°', values: v((m) => m.shoulderTilt) },
    { label: t('Knees ÷ ankles width', 'Rodillas ÷ tobillos'), unit: '', values: v((m) => m.kneeWidth) },
    { label: t('Weight over the right foot', 'Peso sobre el pie derecho'), unit: '%', values: v((m) => m.rightShare) },
  ]
})
const sideRows = computed<Row[]>(() => {
  const a = latest.value
  if (!a) return []
  const cols = earlier.value ? [metricsOf(earlier.value).side_down, metricsOf(a).side_down] : [metricsOf(a).side_up, metricsOf(a).side_down]
  if (!cols.some(Boolean)) return []
  const v = (f: (m: SquatSideMetrics) => number | boolean | null) => cols.map((m) => (m ? f(m) : null))
  return [
    { label: t('Knee angle', 'Ángulo de rodilla'), unit: '°', values: v((m) => m.kneeAngle) },
    { label: t('Hip angle', 'Ángulo de cadera'), unit: '°', values: v((m) => m.hipAngle) },
    { label: t('Hip below the knee', 'Cadera bajo la rodilla'), unit: '', values: v((m) => m.hipBelowKnee) },
    { label: t('Trunk lean', 'Tronco desde la vertical'), unit: '°', values: v((m) => m.trunkLean) },
    { label: t('Shin lean', 'Tibia desde la vertical'), unit: '°', values: v((m) => m.tibiaLean) },
    { label: t('Trunk against shin', 'Tronco frente a tibia'), unit: '°', values: v((m) => m.trunkVsTibia) },
    { label: t('Heel lift', 'Talón levantado'), unit: 'cm', values: v((m) => m.heelLift) },
    { label: t('Knee ahead of the toes', 'Rodilla por delante del pie'), unit: 'cm', values: v((m) => m.kneePastToe) },
  ]
})
const cell = (x: number | boolean | null, unit: string) => (x === null ? '—' : typeof x === 'boolean' ? (x ? t('yes', 'sí') : t('no', 'no')) : `${num(x)}${unit === '°' || unit === '%' || unit === '' ? (unit === '%' ? ' %' : unit) : ` ${unit}`}`)

// Evolución, as on posture: one number across every squat.
const series = (key: SquatTrendKey) => list.value.flatMap((a) => {
  const v = squatTrendValue(metricsOf(a), key)
  return v === null ? [] : [{ takenAt: a.taken_at, value: Math.round(v * 10) / 10 }]
})
const trendMetrics = computed(() => SQUAT_TREND_METRICS.filter((m) => series(m.key).length > 1))
const trendKey = ref<SquatTrendKey>('kneeIn')
watch(trendMetrics, (ms) => {
  if (ms.length && !ms.some((m) => m.key === trendKey.value)) trendKey.value = ms[0]!.key
}, { immediate: true })
const trendMetric = computed(() => trendMetrics.value.find((m) => m.key === trendKey.value) ?? null)
const trendLabel = computed(() => (trendMetric.value ? t(trendMetric.value.label.en, trendMetric.value.label.es) : ''))
const W = 760
const TH = 240
const chart = computed(() => {
  const m = trendMetric.value
  if (!m) return null
  const s = series(m.key)
  const layout = trendLayout(s, 0, { width: W, height: TH, left: 44, right: 24, top: 30, bottom: 40 })
  return { ...layout, line: layout.points.map((p) => `${p.x},${p.y}`).join(' '), summary: trendSummary(s, 0), first: s[0]!, last: s[s.length - 1]! }
})

const balance = computed(() => {
  const m = latest.value ? metricsOf(latest.value) : null
  return { right: m?.front_down?.rightShare ?? null, forward: m?.side_down?.forwardCm ?? null }
})
const suggestions = computed(() => (latest.value ? squatSuggestions(metricsOf(latest.value)) : []))

const removing = ref<Assessment | null>(null)
async function remove() {
  const a = removing.value
  removing.value = null
  if (!a) return
  const { error } = await supabase.from('posture_assessments').delete().eq('id', a.id)
  if (error) return showToast(error.message, 'error')
  await supabase.storage.from('patient-files').remove(Object.values(a.views).map((v) => v!.photo))
  await load()
}

const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString(t('en-GB', 'es-ES'), { maximumFractionDigits: 2 }))
const unitOf = (unit: string) => (unit === '°' ? '°' : ` ${unit}`)
</script>

<template>
  <section class="flex flex-col gap-3" data-cy="squat-section" :data-ready="loading ? undefined : 'true'">
    <p v-if="!loading && !list.length" class="rounded-card border border-dashed border-line-control p-6 text-center text-[13.5px] text-ink-muted" data-cy="squat-empty">
      {{ t('No squat assessments yet: a photo standing and one at the bottom, from the front, the side or both.', 'Aún no hay valoraciones de sentadilla: una foto de pie y otra abajo, de frente, de lado o las dos.') }}
    </p>

    <template v-else-if="list.length">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4" data-pdf-block="kpis">
        <div v-for="k in kpis" :key="k.key" class="rounded-card border border-line bg-surface p-3.5 shadow-card" data-pdf-kpi :data-cy="`squat-kpi-${k.key}`">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ k.label }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-pdf-value>{{ num(k.now) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">{{ k.unit }}</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>
            <template v-if="k.then !== null && beforeAt">{{ shortDay(beforeAt) }}: {{ num(k.then) }}{{ unitOf(k.unit) }} · <span :class="deltaClass(k.now!, k.then)">{{ k.now! - k.then > 0 ? '+' : '' }}{{ num(Math.round((k.now! - k.then) * 10) / 10) }}</span></template>
            <template v-else>{{ k.note }}</template>
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]" data-pdf-skip>
        <ul class="flex flex-col divide-y divide-line-row self-start overflow-hidden rounded-card border border-line bg-surface">
          <li v-for="a in [...list].reverse()" :key="a.id" class="flex items-start gap-2.5 px-3 py-2.5" data-cy="squat-row">
            <input type="checkbox" class="mt-1" :checked="picked.includes(a.id)" :aria-label="t(`Show ${day(a.taken_at)}`, `Ver ${day(a.taken_at)}`)" @change="toggle(a.id)" />
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-semibold text-ink-900">{{ day(a.taken_at) }}</p>
              <p class="text-[12px] text-ink-muted">{{ [a.team_members?.full_name, t(`${Object.keys(a.views).length} photos`, `${Object.keys(a.views).length} fotos`)].filter(Boolean).join(' · ') }}</p>
              <p v-if="a.notes" class="mt-0.5 text-[12px] text-ink-700">{{ a.notes }}</p>
            </div>
            <button v-if="can('visit_notes_delete')" type="button" class="text-[12px] text-ink-muted hover:text-danger-text" :aria-label="t('Delete', 'Eliminar')" data-cy="squat-delete" @click="removing = a">✕</button>
          </li>
        </ul>

        <div class="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-[13.5px] font-semibold text-ink-900">{{ earlier ? t(`${day(earlier.taken_at)} vs ${day(latest!.taken_at)} · bottom`, `${day(earlier.taken_at)} frente a ${day(latest!.taken_at)} · abajo`) : latest ? t(`${day(latest.taken_at)} · standing and bottom`, `${day(latest.taken_at)} · arriba y abajo`) : '' }}</p>
            <span class="flex-1" />
            <label class="flex items-center gap-1.5 text-[12.5px] text-ink-700"><input v-model="showValues" type="checkbox" data-cy="squat-values" />{{ t('Values on the photo', 'Valores en la foto') }}</label>
            <div v-if="planes.length > 1" class="inline-flex overflow-hidden rounded-ctl border border-line-control" role="group" :aria-label="t('Angle', 'Ángulo')">
              <button v-for="p in planes" :key="p" type="button" class="h-8 px-3 text-[12.5px] font-semibold touch:h-11" :class="plane === p ? 'bg-brand-tint text-brand-text' : 'bg-surface text-ink-700'" :aria-pressed="plane === p" :data-cy="`squat-plane-${p}`" @click="plane = p">{{ p === 'front' ? t('Front', 'Frente') : t('Side', 'Lado') }}</button>
            </div>
          </div>
          <div class="grid gap-3" :class="photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-[360px]'">
            <figure v-for="p in photos" :key="p.key" class="m-0 flex flex-col gap-1" data-cy="squat-photo">
              <PostureOverlay :src="p.src" :width="p.sv.width" :height="p.sv.height" :view="p.v" :points="p.sv.points" :tilt="p.sv.tilt ?? null" :labels="false" :callouts="p.callouts" />
              <figcaption class="text-center text-[12px] text-ink-muted">{{ p.caption }} · {{ t(SQUAT_VIEW_LABELS[p.v].en, SQUAT_VIEW_LABELS[p.v].es) }}</figcaption>
            </figure>
          </div>
          <p v-if="!earlier && list.length > 1" class="text-[12.5px] text-ink-muted">{{ t('Tick a second squat in the list to compare its bottom photo and every number with this one.', 'Marca una segunda sentadilla en la lista para comparar su foto de abajo y cada número con esta.') }}</p>

          <div class="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line-divider pt-3 md:grid-cols-2">
            <table v-for="(rows, i) in [frontRows, sideRows].filter((r) => r.length)" :key="i" class="w-full border-collapse text-[13px]" :data-cy="i === 0 && frontRows.length ? 'squat-table-front' : 'squat-table-side'">
              <caption class="mb-1 text-left text-[13.5px] font-semibold text-ink-900">{{ rows === frontRows ? (earlier ? t('From the front · bottom', 'De frente · abajo') : t('From the front', 'De frente')) : earlier ? t('From the side · bottom', 'De lado · abajo') : t('From the side', 'De lado') }}</caption>
              <thead>
                <tr class="border-b border-line text-[11px] uppercase tracking-[.05em] text-ink-muted">
                  <th scope="col" class="py-1.5 text-left font-[640]">{{ t('Measure', 'Medida') }}</th>
                  <th v-for="c in tableCols" :key="c" scope="col" class="py-1.5 text-right font-[640]">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in rows" :key="r.label" class="border-b border-line-row">
                  <td class="py-1.5 text-ink-700">{{ r.label }}</td>
                  <td v-for="(x, j) in r.values" :key="j" class="py-1.5 text-right font-mono text-[12.5px] text-ink-900">{{ cell(x, r.unit) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-[12px] text-ink-muted">{{ t('Estimates from photos, to document and explain — not a diagnosis.', 'Estimaciones a partir de fotos, para documentar y explicar — no para diagnosticar.') }}</p>
        </div>
      </div>

      <section v-if="balance.right !== null || balance.forward !== null" class="rounded-card border border-line bg-surface p-3.5" data-pdf-skip>
        <h4 class="mb-2 text-[14px] font-semibold text-ink-900">{{ t('Where the weight falls at the bottom', 'Dónde cae el peso abajo') }}</h4>
        <PostureBalance :right-share="balance.right" :forward-cm="balance.forward" from="midfoot" />
      </section>

      <PostureSuggestions :patient-id="patientId" :suggestions="suggestions" />

      <section v-if="chart && trendMetric" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5" data-pdf-skip data-cy="squat-evolution">
        <div class="flex flex-wrap items-center gap-2.5">
          <h4 class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('Progress', 'Evolución') }}</h4>
          <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Measurement', 'Medida')">
            <button v-for="m in trendMetrics" :key="m.key" type="button" class="h-9 rounded-pill border px-3 text-[13px] font-semibold touch:h-11" :class="trendKey === m.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="trendKey === m.key" :data-cy="`squat-trend-${m.key}`" @click="trendKey = m.key">{{ t(m.label.en, m.label.es) }}</button>
          </div>
        </div>
        <div class="flex flex-wrap items-stretch gap-4">
          <svg :viewBox="`0 0 ${W} ${TH}`" class="block h-auto min-w-0 flex-[999_1_520px]" role="img" :aria-label="t(`${trendLabel}: from ${num(chart.first.value)} to ${num(chart.last.value)}${unitOf(trendMetric.unit)}`, `${trendLabel}: de ${num(chart.first.value)} a ${num(chart.last.value)}${unitOf(trendMetric.unit)}`)" data-cy="squat-trend">
            <g v-for="g in chart.ticks" :key="g.value">
              <line x1="44" :x2="W - 24" :y1="g.y" :y2="g.y" class="stroke-line" stroke-width="1" />
              <text x="36" :y="g.y + 4" text-anchor="end" class="fill-ink-faint font-mono" font-size="11">{{ num(g.value) }}</text>
            </g>
            <template v-if="trendMetric.idealLabel">
              <line x1="44" :x2="W - 24" :y1="chart.idealY" :y2="chart.idealY" class="stroke-success-text" stroke-width="1.5" stroke-dasharray="6 5" />
              <text :x="W - 24" :y="chart.idealY - 7" text-anchor="end" class="fill-success-text" font-size="11.5" font-weight="600">{{ t(trendMetric.idealLabel.en, trendMetric.idealLabel.es) }}</text>
            </template>
            <polyline :points="chart.line" fill="none" class="stroke-brand" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
            <g v-for="(p, i) in chart.points" :key="p.takenAt">
              <circle :cx="p.x" :cy="p.y" r="5.5" class="fill-surface stroke-brand" stroke-width="2.5" />
              <text :x="p.x" :y="p.y - 12" text-anchor="middle" class="font-mono" :class="i === chart.points.length - 1 ? 'fill-ink-900' : 'fill-ink-700'" font-size="12" font-weight="600">{{ num(p.value) }}</text>
              <text :x="p.x" :y="TH - 10" text-anchor="middle" class="fill-ink-muted" font-size="11.5">{{ shortDay(p.takenAt) }}</text>
            </g>
          </svg>
          <aside class="flex flex-[1_1_220px] flex-col gap-2.5">
            <div v-if="chart.summary" class="rounded-ctl border p-3.5" :class="chart.summary.better === true ? 'border-success-border bg-success-bg' : chart.summary.better === false ? 'border-warning-border bg-warning-bg' : 'border-line bg-surface-subtle'" data-cy="squat-trend-summary">
              <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-700">{{ t(`Since ${shortDay(chart.first.takenAt)}`, `Desde el ${shortDay(chart.first.takenAt)}`) }}</p>
              <p class="mt-1 font-mono text-[24px] font-semibold text-ink-900">{{ chart.summary.delta > 0 ? '+' : chart.summary.delta < 0 ? '−' : '' }}{{ num(Math.abs(chart.summary.delta)) }}{{ unitOf(trendMetric.unit) }}</p>
            </div>
            <p class="rounded-ctl border border-line p-3 text-[12.5px] leading-relaxed text-ink-700">{{ t(trendMetric.help.en, trendMetric.help.es) }}</p>
          </aside>
        </div>
      </section>
    </template>

    <UiConfirmDialog
      v-if="removing"
      tone="danger"
      :title="t(`Delete the squat of ${day(removing.taken_at)}?`, `¿Eliminar la sentadilla del ${day(removing.taken_at)}?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="remove"
      @cancel="removing = null"
    >
      <p class="text-[14px] text-ink-700">{{ t('Its photos are deleted too.', 'Se borran también sus fotos.') }}</p>
    </UiConfirmDialog>
  </section>
</template>
