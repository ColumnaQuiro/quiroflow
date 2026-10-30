<script setup lang="ts">
import { postureHeadline, POSTURE_VIEWS, VIEW_LABELS, type PostureView, type StoredViews, type ViewMetrics } from '../../utils/posture'
import { remeasure, TREND_METRICS, trendLayout, trendSeries, trendSummary, type TrendKey } from '../../utils/postureTrend'

// "Postura" on the record's Progreso tab: the patient's posture assessments
// (posture_assessments), two of them side by side in any view with the same
// points and vertical drawn, the headline numbers then and now, how the head
// has moved over time, and whether the patient may see each one in their
// app. A new one is taken on /patients/posture/<id>. The numbers are part of
// the "Informe de revisión" PDF (data-pdf-*), the photos are not.
// `can`: the staff app passes its own (usePractitionerContext). It has no
// web account store: usePermission() calls useAccountStore(), which the app
// does not even import, so calling it there threw in setup and the whole
// section silently never rendered on any patient. Only the web calls it.
const props = defineProps<{ patientId: string; can?: (permission: string) => boolean }>()

const t = useT()
const supabase = useSupabaseClient()
const webPermission = props.can ? null : usePermission()
const can = (permission: string) => (props.can ? props.can(permission) : webPermission!.can(permission as never))
const { showToast } = useToast()

interface Assessment {
  id: string
  taken_at: string
  height_cm: number
  views: StoredViews
  metrics: Partial<Record<PostureView, ViewMetrics>>
  notes: string | null
  shared_with_patient: boolean
  team_members: { full_name: string } | null
}
const list = ref<Assessment[]>([])
const urls = ref<Record<string, string>>({})
const loading = ref(true)

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('posture_assessments')
    .select('id, taken_at, height_cm, views, metrics, notes, shared_with_patient, team_members(full_name)')
    .eq('patient_id', props.patientId)
    .order('taken_at')
  list.value = (data as unknown as Assessment[] | null) ?? []
  const paths = list.value.flatMap((a) => Object.values(a.views).map((v) => v!.photo))
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('patient-files').createSignedUrls(paths, 3600)
    urls.value = Object.fromEntries((signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])))
  }
  // Compare the first with the latest unless someone picked otherwise.
  picked.value = list.value.length >= 2 ? [list.value[0]!.id, list.value[list.value.length - 1]!.id] : list.value.map((a) => a.id)
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

const picked = ref<string[]>([])
function toggle(id: string) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value.slice(-1), id]
}
const pair = computed(() => list.value.filter((a) => picked.value.includes(a.id)))
const views = computed(() => POSTURE_VIEWS.filter((v) => pair.value.length && pair.value.every((a) => a.views[v])))
const view = ref<PostureView>('right')
// Every photo of the two being compared, fetched ahead, so switching view
// shows the next photo at once instead of waiting on the network.
watch(pair, (as) => {
  for (const a of as) for (const v of Object.values(a.views)) if (urls.value[v!.photo]) new Image().src = urls.value[v!.photo]!
})
watch(views, (vs) => {
  if (vs.length && !vs.includes(view.value)) view.value = vs.includes('right') ? 'right' : vs[0]!
})

const first = computed(() => (pair.value[0] ? postureHeadline(pair.value[0].metrics) : null))
const last = computed(() => (pair.value.length > 1 ? postureHeadline(pair.value[pair.value.length - 1]!.metrics) : first.value))
const delta = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || b === null || b === undefined || pair.value.length < 2 ? null : Math.round((b - a) * 10) / 10)
const kpis = computed(() => {
  if (!first.value || !last.value) return []
  return [
    { key: 'weight', label: t('Effective head weight', 'Peso efectivo de la cabeza'), unit: 'kg', now: last.value.headWeight, then: first.value.headWeight },
    { key: 'forward', label: t('Head ahead of shoulder', 'Cabeza por delante del hombro'), unit: 'cm', now: last.value.headForward, then: first.value.headForward },
    { key: 'shoulders', label: t('Shoulder tilt', 'Inclinación de hombros'), unit: '°', now: last.value.shoulderTilt, then: first.value.shoulderTilt },
    { key: 'pelvis', label: t('Pelvic tilt', 'Inclinación de pelvis'), unit: '°', now: last.value.hipTilt, then: first.value.hipTilt },
  ].filter((k) => k.now !== null)
})

// Evolución: any one of the headline numbers across every assessment, as
// its distance from aligned (utils/postureTrend.ts), so lower is better and
// the green line is aligned for all of them. Measured again from each one's
// points, so an older assessment has the knees too.
const lang = computed(() => t('en', 'es') as 'en' | 'es')
const measured = computed(() => list.value.map((a) => ({ takenAt: a.taken_at, metrics: remeasure({ takenAt: a.taken_at, heightCm: Number(a.height_cm), views: a.views, metrics: a.metrics }) })))
// Only the numbers measured at least twice: one point is not a trend.
const trendMetrics = computed(() => TREND_METRICS.filter((m) => trendSeries(measured.value, m.key).length > 1))
const trendKey = ref<TrendKey>('headWeight')
watch(trendMetrics, (ms) => {
  if (ms.length && !ms.some((m) => m.key === trendKey.value)) trendKey.value = ms[0]!.key
}, { immediate: true })
const trendMetric = computed(() => trendMetrics.value.find((m) => m.key === trendKey.value) ?? null)
const W = 760
const TH = 270
const chart = computed(() => {
  const m = trendMetric.value
  if (!m) return null
  const series = trendSeries(measured.value, m.key)
  const layout = trendLayout(series, m.ideal, { width: W, height: TH, left: 44, right: 24, top: 30, bottom: 40 })
  const pts = layout.points
  return {
    ...layout,
    line: pts.map((p) => `${p.x},${p.y}`).join(' '),
    area: `M${pts[0]!.x},${layout.baseY} L${pts.map((p) => `${p.x},${p.y}`).join(' L')} L${pts[pts.length - 1]!.x},${layout.baseY} Z`,
    summary: trendSummary(series, m.ideal),
    first: series[0]!,
    last: series[series.length - 1]!,
  }
})
const unitOf = (unit: string) => (unit === '°' ? '°' : ` ${unit}`)
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })

async function setShared(a: Assessment, shared: boolean) {
  const { error } = await supabase.from('posture_assessments').update({ shared_with_patient: shared }).eq('id', a.id)
  if (error) return showToast(error.message, 'error')
  a.shared_with_patient = shared
}
// X-rays marked in Archivos: two of them side by side.
const xrays = ref<{ id: string; file_name: string; created_at: string; url: string | null }[]>([])
const xrayPick = ref<string[]>([])
async function loadXrays() {
  const { data } = await supabase.from('patient_files').select('id, file_name, created_at, storage_path').eq('patient_id', props.patientId).eq('is_xray', true).not('storage_path', 'is', null).order('created_at')
  const rows = (data as { id: string; file_name: string; created_at: string; storage_path: string }[] | null) ?? []
  const { data: signed } = rows.length ? await supabase.storage.from('patient-files').createSignedUrls(rows.map((r) => r.storage_path), 3600) : { data: [] }
  const byPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]))
  xrays.value = rows.map((r) => ({ id: r.id, file_name: r.file_name, created_at: r.created_at, url: byPath.get(r.storage_path) ?? null }))
  xrayPick.value = xrays.value.slice(-2).map((x) => x.id)
}
watch(() => props.patientId, loadXrays, { immediate: true })
function toggleXray(id: string) {
  xrayPick.value = xrayPick.value.includes(id) ? xrayPick.value.filter((x) => x !== id) : [...xrayPick.value.slice(-1), id]
}
const xrayPair = computed(() => xrays.value.filter((x) => xrayPick.value.includes(x.id)))

// The posture report for the patient (server/api/posture/[id]/report): built
// on the server, opened from a link, which is what works in the app's WebView
// as well as on the web -- see utils/openWhenReady.ts.
const reporting = ref<string | null>(null)
function openReport(a: Assessment) {
  reporting.value = a.id
  openWhenReady(async () => {
    try {
      const { url } = await useStaffFetch<{ url: string }>(`/api/posture/${a.id}/report`, { method: 'POST' })
      return url
    } catch (e) {
      showToast((e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not prepare the report.', 'No se ha podido preparar el informe.'), 'error')
      return null
    } finally {
      reporting.value = null
    }
  })
}

const removing = ref<Assessment | null>(null)
async function remove() {
  const a = removing.value
  removing.value = null
  if (!a) return
  const { error } = await supabase.from('posture_assessments').delete().eq('id', a.id)
  if (error) return showToast(error.message, 'error')
  // The photos, and the report built from them if one ever was.
  const photos = Object.values(a.views).map((v) => v!.photo)
  await supabase.storage.from('patient-files').remove([...photos, photos[0]!.replace(/[^/]+$/, 'informe.pdf')])
  await load()
}

const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('es-ES'))
</script>

<template>
  <section class="flex flex-col gap-3" data-cy="posture-section" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-3" data-pdf-skip>
      <h3 class="text-[15px] font-bold text-ink-900">{{ t('Posture', 'Postura') }}</h3>
      <span class="text-[12.5px] text-ink-muted">{{ t('Estimates from photos, to document and explain', 'Estimaciones a partir de fotos, para documentar y explicar') }}</span>
      <span class="flex-1" />
      <NuxtLink v-if="can('visit_notes_access')" :to="`/patients/posture/${patientId}`" class="inline-flex h-9 items-center rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-brand-on" data-cy="posture-new">{{ t('New assessment', 'Nueva valoración') }}</NuxtLink>
    </div>

    <p v-if="!loading && !list.length" class="rounded-card border border-dashed border-line-control p-6 text-center text-[13.5px] text-ink-muted" data-cy="posture-empty">
      {{ t('No posture assessments yet: three photos, the points placed for you, and the measurements at once.', 'Aún no hay valoraciones de postura: tres fotos, los puntos se colocan solos y las medidas salen al momento.') }}
    </p>

    <template v-else-if="list.length">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4" data-pdf-block="kpis">
        <div v-for="k in kpis" :key="k.key" class="rounded-card border border-line bg-surface p-3.5 shadow-card" data-pdf-kpi :data-cy="`posture-kpi-${k.key}`">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ k.label }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-pdf-value>{{ num(k.now) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">{{ k.unit }}</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>
            <template v-if="delta(k.then, k.now) !== null">{{ t(`${day(pair[0]!.taken_at)}: ${num(k.then)} ${k.unit}`, `${day(pair[0]!.taken_at)}: ${num(k.then)} ${k.unit}`) }} · <span :class="Math.abs(delta(k.then, k.now)!) < Math.abs(0.05) ? '' : Math.abs(k.now!) < Math.abs(k.then!) ? 'text-success-text' : 'text-warning-text'">{{ delta(k.then, k.now)! > 0 ? '+' : '' }}{{ num(delta(k.then, k.now)) }}</span></template>
            <template v-else>{{ day(pair[pair.length - 1]?.taken_at ?? list[list.length - 1]!.taken_at) }}</template>
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]" data-pdf-skip>
        <ul class="flex flex-col divide-y divide-line-row overflow-hidden rounded-card border border-line bg-surface">
          <li v-for="a in [...list].reverse()" :key="a.id" class="flex items-start gap-2.5 px-3 py-2.5" data-cy="posture-row">
            <input type="checkbox" class="mt-1" :checked="picked.includes(a.id)" :aria-label="t(`Compare ${day(a.taken_at)}`, `Comparar ${day(a.taken_at)}`)" @change="toggle(a.id)" />
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-semibold text-ink-900">{{ day(a.taken_at) }}</p>
              <p class="text-[12px] text-ink-muted">{{ [a.team_members?.full_name, t(`${Object.keys(a.views).length} photos`, `${Object.keys(a.views).length} fotos`)].filter(Boolean).join(' · ') }}</p>
              <label class="mt-1 flex items-center gap-1.5 text-[12px] text-ink-700"><input type="checkbox" :checked="a.shared_with_patient" data-cy="posture-share" @change="setShared(a, ($event.target as HTMLInputElement).checked)" />{{ t('Patient can see it', 'Lo ve el paciente') }}</label>
              <button type="button" class="mt-1.5 inline-flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[12px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-60" :disabled="reporting === a.id" data-cy="posture-report" @click="openReport(a)">{{ reporting === a.id ? t('Preparing…', 'Preparando…') : t('Report (PDF)', 'Informe (PDF)') }}</button>
            </div>
            <button v-if="can('visit_notes_delete')" type="button" class="text-[12px] text-ink-muted hover:text-danger-text" :aria-label="t('Delete', 'Eliminar')" @click="removing = a">✕</button>
          </li>
        </ul>

        <div class="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-[13.5px] font-semibold text-ink-900">{{ pair.map((a) => day(a.taken_at)).join(t(' vs ', ' frente a ')) }}</p>
            <span class="flex-1" />
            <div class="inline-flex overflow-hidden rounded-ctl border border-line-control" role="group" :aria-label="t('View', 'Vista')">
              <button v-for="v in views" :key="v" type="button" class="h-8 px-3 text-[12.5px] font-semibold" :class="view === v ? 'bg-brand-tint text-brand-text' : 'bg-surface text-ink-700'" :aria-pressed="view === v" :data-cy="`posture-compare-${v}`" @click="view = v">{{ VIEW_LABELS[v] }}</button>
            </div>
          </div>
          <div class="grid gap-3" :class="pair.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-[360px]'">
            <figure v-for="a in pair" :key="a.id" class="m-0 flex flex-col gap-1" data-cy="posture-compare-photo">
              <PostureOverlay v-if="a.views[view] && urls[a.views[view]!.photo]" :src="urls[a.views[view]!.photo]!" :width="a.views[view]!.width" :height="a.views[view]!.height" :view="view" :points="a.views[view]!.points" :labels="false" />
              <figcaption class="text-center text-[12px] text-ink-muted">{{ day(a.taken_at) }}</figcaption>
            </figure>
          </div>
        </div>
      </div>

      <section v-if="chart && trendMetric" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5" data-pdf-block="image" data-pdf-span="12" data-cy="posture-evolution">
        <div class="flex flex-wrap items-center gap-2.5">
          <h4 class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('Progress', 'Evolución') }}</h4>
          <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('Measurement', 'Medida')" data-pdf-skip>
            <button
              v-for="m in trendMetrics"
              :key="m.key"
              type="button"
              class="h-9 rounded-pill border px-3 text-[13px] font-semibold"
              :class="trendKey === m.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
              :aria-pressed="trendKey === m.key"
              :data-cy="`posture-trend-${m.key}`"
              @click="trendKey = m.key"
            >{{ m.short[lang] }}</button>
          </div>
        </div>
        <div class="flex flex-wrap items-stretch gap-4">
          <div class="min-w-0 flex-[999_1_520px]">
            <p class="mb-1 text-[12.5px] text-ink-muted">{{ t(`${trendMetric.label.en} (${trendMetric.unit}), at each assessment`, `${trendMetric.label.es} (${trendMetric.unit}), en cada valoración`) }}</p>
            <svg
              :viewBox="`0 0 ${W} ${TH}`"
              class="block h-auto w-full"
              role="img"
              :aria-label="t(`${trendMetric.label.en}: from ${num(chart.first.value)} to ${num(chart.last.value)} ${trendMetric.unit}`, `${trendMetric.label.es}: de ${num(chart.first.value)} a ${num(chart.last.value)} ${trendMetric.unit}`)"
              data-cy="posture-trend"
              :data-metric="trendMetric.key"
            >
              <g v-for="g in chart.ticks" :key="g.value">
                <line x1="44" :x2="W - 24" :y1="g.y" :y2="g.y" class="stroke-line" stroke-width="1" />
                <text x="36" :y="g.y + 4" text-anchor="end" class="fill-ink-faint font-mono" font-size="11">{{ num(g.value) }}</text>
              </g>
              <path :d="chart.area" class="fill-brand" fill-opacity="0.07" />
              <line x1="44" :x2="W - 24" :y1="chart.idealY" :y2="chart.idealY" class="stroke-success-text" stroke-width="1.5" stroke-dasharray="6 5" />
              <text :x="W - 24" :y="chart.idealY - 7" text-anchor="end" class="fill-success-text" font-size="11.5" font-weight="600">{{ trendMetric.idealLabel[lang] }}</text>
              <polyline :points="chart.line" fill="none" class="stroke-brand" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
              <g v-for="(p, i) in chart.points" :key="p.takenAt">
                <circle :cx="p.x" :cy="p.y" r="5.5" class="fill-surface stroke-brand" stroke-width="2.5" />
                <text :x="p.x" :y="p.y - 12" text-anchor="middle" class="font-mono" :class="i === chart.points.length - 1 ? 'fill-ink-900' : 'fill-ink-700'" font-size="12" font-weight="600">{{ num(p.value) }}</text>
                <text :x="p.x" :y="TH - 10" text-anchor="middle" class="fill-ink-muted" font-size="11.5">{{ shortDay(p.takenAt) }}</text>
              </g>
            </svg>
          </div>
          <aside class="flex flex-[1_1_220px] flex-col gap-2.5">
            <div
              v-if="chart.summary"
              class="rounded-ctl border p-3.5"
              :class="chart.summary.better === true ? 'border-success-border bg-success-bg' : chart.summary.better === false ? 'border-warning-border bg-warning-bg' : 'border-line bg-surface-subtle'"
              data-cy="posture-trend-summary"
              :data-better="chart.summary.better === null ? 'same' : String(chart.summary.better)"
            >
              <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-700">{{ t(`Since ${shortDay(chart.first.takenAt)}`, `Desde el ${shortDay(chart.first.takenAt)}`) }}</p>
              <p class="mt-1 font-mono text-[24px] font-semibold text-ink-900">{{ chart.summary.delta > 0 ? '+' : chart.summary.delta < 0 ? '−' : '' }}{{ num(Math.abs(chart.summary.delta)) }}{{ unitOf(trendMetric.unit) }}</p>
              <p class="text-[13px] text-ink-700">
                <template v-if="chart.summary.better === true">{{ chart.summary.share !== null ? t(`Closer to aligned: ${chart.summary.share}% of the way.`, `Más cerca de lo alineado: ${chart.summary.share} % del camino.`) : t('Closer to aligned.', 'Más cerca de lo alineado.') }}</template>
                <template v-else-if="chart.summary.better === false">{{ t('Further from aligned than at the start.', 'Más lejos de lo alineado que al empezar.') }}</template>
                <template v-else>{{ t('About the same as at the start.', 'Más o menos igual que al empezar.') }}</template>
              </p>
            </div>
            <p class="rounded-ctl border border-line p-3 text-[12.5px] leading-relaxed text-ink-700">{{ trendMetric.help[lang] }}</p>
            <p class="text-[12px] text-ink-muted">{{ t('The dashed green line is aligned. The closer to it, the better.', 'La línea verde discontinua es lo alineado. Más cerca de ella, mejor.') }}</p>
          </aside>
        </div>
      </section>
    </template>

    <section v-if="xrays.length" class="rounded-card border border-line bg-surface p-3.5" data-pdf-skip data-cy="posture-xrays">
      <div class="flex flex-wrap items-center gap-2">
        <h4 class="text-[13.5px] font-semibold text-ink-900">{{ t('X-rays', 'Radiografías') }}</h4>
        <span class="text-[12px] text-ink-muted">{{ t('Marked in Attachments · pick two', 'Marcadas en Adjuntos · elige dos') }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button v-for="x in xrays" :key="x.id" type="button" class="h-8 rounded-pill border px-3 text-[12.5px] font-semibold" :class="xrayPick.includes(x.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="xrayPick.includes(x.id)" @click="toggleXray(x.id)">{{ day(x.created_at) }} · {{ x.file_name }}</button>
      </div>
      <div class="mt-2 grid gap-3" :class="xrayPair.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-[420px]'">
        <figure v-for="x in xrayPair" :key="x.id" class="m-0 flex flex-col gap-1">
          <img v-if="x.url" :src="x.url" :alt="x.file_name" class="w-full rounded-card bg-ink-900 object-contain" />
          <figcaption class="text-center text-[12px] text-ink-muted">{{ day(x.created_at) }}</figcaption>
        </figure>
      </div>
    </section>

    <UiConfirmDialog
      v-if="removing"
      tone="danger"
      :title="t(`Delete the assessment of ${day(removing.taken_at)}?`, `¿Eliminar la valoración del ${day(removing.taken_at)}?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="remove"
      @cancel="removing = null"
    >
      <p class="text-[14px] text-ink-700">{{ t('Its photos are deleted too.', 'Se borran también sus fotos.') }}</p>
    </UiConfirmDialog>
  </section>
</template>
