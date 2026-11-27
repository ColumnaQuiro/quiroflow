<script setup lang="ts">
import { blindSpotAsymmetry, formatBlindSpotArea, type BlindSpotTestRow } from '../../utils/blindSpot'

// The patient record's Blind Spot tab: each test session (a lone test, or a
// before/after pair), both eyes' maps, the difference between eyes visit by
// visit, and the two-page report for the patient
// (server/api/blind-spot/report.post.ts). The staff app shows it too
// (mobile/pages/patients/[id].vue): every store field read here must exist
// in mobile/composables/useAccountStore.ts.
const props = defineProps<{ patientId: string }>()

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { showToast } = useToast()
const lang = computed(() => (t('en', 'es') === 'es' ? 'es' : 'en'))

const rows = ref<BlindSpotTestRow[]>([])
const loading = ref(true)
async function load() {
  loading.value = true
  const { data, error } = await supabase
    .from('blind_spot_tests')
    .select('id, patient_id, session_id, phase, right_eye, left_eye, right_area, left_area, points_per_eye, distance_cm, px_per_mm, note, tested_at, created_by')
    .eq('patient_id', props.patientId)
    .order('tested_at', { ascending: false })
  if (error) showToast(t('Could not load the tests.', 'No se han podido cargar las pruebas.'), 'error')
  rows.value = (data ?? []) as unknown as BlindSpotTestRow[]
  loading.value = false
}
onMounted(load)

interface Session {
  id: string
  testedAt: string
  before: BlindSpotTestRow | null
  after: BlindSpotTestRow
}
// A pair shows before and after; a lone test, or a "before" still waiting
// for its "after", shows on its own.
const sessions = computed<Session[]>(() => {
  const by = new Map<string, BlindSpotTestRow[]>()
  for (const r of rows.value) by.set(r.session_id, [...(by.get(r.session_id) ?? []), r])
  return [...by.entries()]
    .map(([id, list]) => {
      const pre = list.find((r) => r.phase === 'pre') ?? null
      const post = list.find((r) => r.phase === 'post') ?? null
      const single = list.find((r) => r.phase === 'single') ?? null
      const after = post ?? single ?? pre!
      return { id, testedAt: after.tested_at, before: post ? pre : null, after }
    })
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))
})

const selectedId = ref<string | null>(null)
const selected = computed(() => sessions.value.find((s) => s.id === selectedId.value) ?? sessions.value[0] ?? null)
const view = ref<'before' | 'after' | 'both'>('both')

function day(iso: string) {
  return new Date(iso).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function sessionLabel(s: Session) {
  return s.before ? t(`${day(s.testedAt)} · before and after the adjustment`, `${day(s.testedAt)} · antes y después del ajuste`) : s.after.phase === 'pre' ? t(`${day(s.testedAt)} · before the adjustment`, `${day(s.testedAt)} · antes del ajuste`) : day(s.testedAt)
}
const area = (v: number | null | undefined) => formatBlindSpotArea(v, lang.value)
function pair(before: number | null | undefined, after: number | null | undefined) {
  return before != null ? `${area(before)} → ${area(after)}` : area(after)
}
function change(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || before <= 0) return null
  return Math.round(((after - before) / before) * 100)
}

const asymBefore = computed(() => (selected.value?.before ? blindSpotAsymmetry(selected.value.before.right_area, selected.value.before.left_area) : null))
const asymAfter = computed(() => (selected.value ? blindSpotAsymmetry(selected.value.after.right_area, selected.value.after.left_area) : null))
const reliability = computed(() => {
  const s = selected.value
  if (!s) return null
  const tests = [s.before, s.after].filter(Boolean) as BlindSpotTestRow[]
  const catches = tests.reduce((n, r) => n + (r.right_eye.catch_trials ?? 0) + (r.left_eye.catch_trials ?? 0), 0)
  const fp = tests.reduce((n, r) => n + (r.right_eye.false_positives ?? 0) + (r.left_eye.false_positives ?? 0), 0)
  return { ok: catches - fp, of: catches }
})

// The difference between eyes, session by session, oldest first.
const trend = computed(() => {
  const list = sessions.value.slice().reverse().slice(-8)
  const values = list.map((s) => ({
    label: day(s.testedAt).replace(/\s\d{4}$/, ''),
    before: s.before ? blindSpotAsymmetry(s.before.right_area, s.before.left_area)?.percent ?? null : null,
    after: blindSpotAsymmetry(s.after.right_area, s.after.left_area)?.percent ?? null,
    current: s.id === selected.value?.id,
  }))
  const max = Math.max(10, ...values.flatMap((v) => [v.before ?? 0, v.after ?? 0]))
  const top = Math.ceil(max / 10) * 10
  const w = 560
  const x0 = 48
  const step = values.length > 1 ? (w - x0 - 40) / (values.length - 1) : 0
  const y = (v: number) => 160 - (v / top) * 135
  return {
    top,
    grid: [0, top / 2, top].map((g) => ({ g, y: y(g) })),
    points: values.map((v, i) => ({ ...v, x: values.length > 1 ? x0 + 20 + i * step : (w + x0) / 2, yb: v.before != null ? y(v.before) : null, ya: v.after != null ? y(v.after) : null })),
  }
})

// The note on the session: the "after" one's, else the "before" one's.
const noteText = computed(() => selected.value?.after.note || selected.value?.before?.note || '')

const reporting = ref(false)
function openReport() {
  if (!selected.value) return
  reporting.value = true
  const sessionId = selected.value.id
  openWhenReady(async () => {
    try {
      const { url } = await useStaffFetch<{ url: string }>('/api/blind-spot/report', { method: 'POST', body: { sessionId } })
      return url
    } catch (e) {
      showToast((e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('Could not prepare the report.', 'No se ha podido preparar el informe.'), 'error')
      return null
    } finally {
      reporting.value = false
    }
  })
}

const pending = computed(() => (selected.value?.after.phase === 'pre' ? selected.value : null))
const canTest = computed(() => store.hasBlindSpot && can('visit_notes_access'))
const newTestTo = computed(() => `/patients/blind-spot/${props.patientId}`)
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="blind-spot-tab">
    <div class="flex flex-wrap items-end gap-3">
      <div v-if="sessions.length" class="flex flex-col gap-1">
        <label for="bs-session" class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Test', 'Prueba') }}</label>
        <select id="bs-session" :value="selected?.id" class="h-9 min-w-[260px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] touch:h-11" data-cy="blind-spot-session" @change="selectedId = ($event.target as HTMLSelectElement).value">
          <option v-for="s in sessions" :key="s.id" :value="s.id">{{ sessionLabel(s) }}</option>
        </select>
      </div>
      <span class="flex-1" />
      <UiBtn v-if="selected" :disabled="reporting" data-cy="blind-spot-report" @click="openReport">{{ reporting ? t('Preparing…', 'Preparando…') : t('Report PDF', 'Informe PDF') }}</UiBtn>
      <NuxtLink
        v-if="pending && canTest"
        :to="{ path: newTestTo, query: { session: pending.id, phase: 'post' } }"
        class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 touch:h-11"
      >
        {{ t('Measure after the adjustment', 'Medir después del ajuste') }}
      </NuxtLink>
      <NuxtLink
        v-if="canTest"
        :to="newTestTo"
        class="inline-flex h-9 items-center rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11"
        data-cy="blind-spot-new"
      >
        {{ t('New test', 'Nueva prueba') }}
      </NuxtLink>
    </div>

    <UiSkeleton v-if="loading" class="h-64 w-full" />
    <UiEmptyState
      v-else-if="!sessions.length"
      :title="t('No blind spot tests yet', 'Aún no hay pruebas de punto ciego')"
      :description="canTest
        ? t('Measure both eyes in about two minutes, before and after the adjustment if you like.', 'Mide los dos ojos en unos dos minutos, antes y después del ajuste si quieres.')
        : store.hasBlindSpot ? t('Running a test needs “See visit notes”.', 'Hacer una prueba requiere «Ver notas de visita».') : t('Blind Spot is not on your subscription. Add it under Subscription.', 'Blind Spot no está en tu suscripción. Añádelo en Suscripción.')"
    />

    <template v-else-if="selected">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <div class="rounded-card border border-line bg-surface p-3.5 shadow-card" data-cy="blind-spot-kpi-left">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Area · left eye', 'Área · ojo izquierdo') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ pair(selected.before?.left_area, selected.after.left_area) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">°²</span></p>
          <p v-if="change(selected.before?.left_area, selected.after.left_area) !== null" class="text-[12px] text-ink-muted">{{ change(selected.before?.left_area, selected.after.left_area)! > 0 ? '+' : '' }}{{ change(selected.before?.left_area, selected.after.left_area) }} % {{ t('after the adjustment', 'tras el ajuste') }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-3.5 shadow-card" data-cy="blind-spot-kpi-right">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Area · right eye', 'Área · ojo derecho') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ pair(selected.before?.right_area, selected.after.right_area) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">°²</span></p>
          <p v-if="change(selected.before?.right_area, selected.after.right_area) !== null" class="text-[12px] text-ink-muted">{{ change(selected.before?.right_area, selected.after.right_area)! > 0 ? '+' : '' }}{{ change(selected.before?.right_area, selected.after.right_area) }} % {{ t('after the adjustment', 'tras el ajuste') }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-3.5 shadow-card" data-cy="blind-spot-kpi-asymmetry">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Difference between eyes', 'Diferencia entre ojos') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">
            <template v-if="asymBefore">{{ asymBefore.percent }} % → </template>{{ asymAfter ? `${asymAfter.percent} %` : '—' }}
          </p>
          <p v-if="asymAfter?.larger" class="text-[12px] text-ink-muted">{{ asymAfter.larger === 'left' ? t('Left one larger', 'Mayor el izquierdo') : t('Right one larger', 'Mayor el derecho') }}</p>
        </div>
        <div v-if="reliability" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Reliability', 'Fiabilidad') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ reliability.ok }}/{{ reliability.of }}</p>
          <p class="text-[12px] text-ink-muted">{{ t(`checks with no false positive · ${selected.after.distance_cm} cm`, `controles sin falso positivo · ${selected.after.distance_cm} cm`) }}</p>
        </div>
      </div>

      <section class="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4 shadow-card" aria-labelledby="bs-maps">
        <div class="flex flex-wrap items-center gap-3">
          <h2 id="bs-maps" class="flex-1 text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Blind spot maps', 'Mapas del punto ciego') }}</h2>
          <div v-if="selected.before" role="group" :aria-label="t('What to show', 'Qué mostrar')" class="inline-flex gap-0.5 rounded-ctl bg-chip-bg p-0.5">
            <button
              v-for="opt in ([['before', t('Before', 'Antes')], ['after', t('After', 'Después')], ['both', t('Overlay', 'Superponer')]] as const)"
              :key="opt[0]"
              type="button"
              :aria-pressed="view === opt[0]"
              class="h-8 rounded-ctlSm px-3 text-[13px]"
              :class="view === opt[0] ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-muted'"
              @click="view = opt[0]"
            >
              {{ opt[1] }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-4 text-[12.5px] text-ink-muted">
          <span v-if="selected.before" class="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" class="stroke-warning-accent" stroke-width="1.5" stroke-dasharray="4 3" /></svg>{{ t('Before the adjustment', 'Antes del ajuste') }}</span>
          <span class="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" class="stroke-brand" stroke-width="2" /></svg>{{ selected.before ? t('After the adjustment', 'Después del ajuste') : t('Measured', 'Medido') }}</span>
          <span class="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" class="stroke-ink-faint3" stroke-width="1.5" stroke-dasharray="2 3" /></svg>{{ t('Typical size (≈ 5.5° × 7.5°)', 'Tamaño de referencia (≈ 5,5° × 7,5°)') }}</span>
          <span>{{ t(`${selected.after.points_per_eye} points per eye`, `${selected.after.points_per_eye} puntos por ojo`) }}</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          <figure class="m-0 flex flex-col gap-2">
            <figcaption class="flex flex-wrap justify-between gap-2 text-[13px]"><span class="font-semibold text-ink-900">{{ t('Left eye', 'Ojo izquierdo') }}</span><span class="font-mono text-ink-muted">{{ pair(selected.before?.left_area, selected.after.left_area) }} °²</span></figcaption>
            <BlindspotMap eye="left" :before="selected.before?.left_eye.points" :after="selected.after.left_eye.points" :show-before="view !== 'after'" :show-after="view !== 'before'" :label="t('Left eye blind spot map', 'Mapa del punto ciego del ojo izquierdo')" />
          </figure>
          <figure class="m-0 flex flex-col gap-2">
            <figcaption class="flex flex-wrap justify-between gap-2 text-[13px]"><span class="font-semibold text-ink-900">{{ t('Right eye', 'Ojo derecho') }}</span><span class="font-mono text-ink-muted">{{ pair(selected.before?.right_area, selected.after.right_area) }} °²</span></figcaption>
            <BlindspotMap eye="right" :before="selected.before?.right_eye.points" :after="selected.after.right_eye.points" :show-before="view !== 'after'" :show-after="view !== 'before'" :label="t('Right eye blind spot map', 'Mapa del punto ciego del ojo derecho')" />
          </figure>
        </div>
      </section>

      <div class="flex flex-wrap gap-4">
        <section v-if="sessions.length > 1" class="flex min-w-0 flex-[2_1_480px] flex-col gap-2.5 rounded-card border border-line bg-surface p-4 shadow-card" aria-labelledby="bs-trend">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="bs-trend" class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Difference between eyes over time', 'Evolución de la diferencia entre ojos') }}</h2>
            <span class="text-[12.5px] text-ink-muted">{{ t('Each line joins before and after the adjustment', 'Cada línea une antes y después del ajuste') }}</span>
          </div>
          <svg viewBox="0 0 560 190" class="block h-auto w-full" role="img" :aria-label="t('Difference between eyes at each test', 'Diferencia entre ojos en cada prueba')">
            <template v-for="g in trend.grid" :key="g.g">
              <line x1="48" :y1="g.y" x2="548" :y2="g.y" class="stroke-line-row" />
              <text x="40" :y="g.y + 3" text-anchor="end" font-size="10" class="fill-ink-muted font-mono">{{ g.g }} %</text>
            </template>
            <template v-for="(p, i) in trend.points" :key="i">
              <line v-if="p.yb != null && p.ya != null" :x1="p.x" :y1="p.yb" :x2="p.x" :y2="p.ya" class="stroke-line-controlHover" stroke-width="2" />
              <circle v-if="p.yb != null" :cx="p.x" :cy="p.yb" r="5" class="fill-surface stroke-warning-accent" stroke-width="2" />
              <circle v-if="p.ya != null" :cx="p.x" :cy="p.ya" r="5" class="fill-brand" />
              <text :x="p.x" y="182" text-anchor="middle" font-size="11" :class="p.current ? 'fill-ink-900 font-semibold' : 'fill-ink-muted'">{{ p.label }}</text>
            </template>
          </svg>
        </section>
        <section v-if="noteText" class="flex min-w-0 flex-[1_1_280px] flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-card" aria-labelledby="bs-note">
          <h2 id="bs-note" class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Note', 'Nota') }}</h2>
          <p class="whitespace-pre-line text-[13px] text-ink-700">{{ noteText }}</p>
        </section>
      </div>

      <p class="text-[12px] text-ink-faint">{{ t('A functional measure of the visual field for follow-up in the clinic. Not a diagnostic test, and no substitute for an eye examination.', 'Medición funcional del campo visual para seguimiento en consulta. No es una prueba diagnóstica ni sustituye una exploración oftalmológica.') }}</p>
    </template>
  </div>
</template>
