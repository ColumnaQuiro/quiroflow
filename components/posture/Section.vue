<script setup lang="ts">
import { postureHeadline, POSTURE_VIEWS, VIEW_LABELS, type PostureView, type StoredViews, type ViewMetrics } from '../../utils/posture'

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

// Head ahead of the shoulder, assessment by assessment.
const trend = computed(() => list.value.map((a) => ({ a, v: postureHeadline(a.metrics).headForward })).filter((p) => p.v !== null) as { a: Assessment; v: number }[])
const W = 720
const TH = 150
const trendPts = computed(() => {
  const vs = trend.value.map((p) => p.v)
  const max = Math.max(1, ...vs)
  const min = Math.min(0, ...vs)
  const n = trend.value.length
  return trend.value.map((p, i) => ({ x: 40 + (n <= 1 ? (W - 60) / 2 : (i * (W - 60)) / (n - 1)), y: 14 + ((max - p.v) * (TH - 44)) / (max - min || 1), p }))
})

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
const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('es-ES'))
</script>

<template>
  <section class="flex flex-col gap-3" data-cy="posture-section" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-3" data-pdf-skip>
      <h3 class="text-[15px] font-bold text-ink-900">{{ t('Posture', 'Postura') }}</h3>
      <span class="text-[12.5px] text-ink-muted">{{ t('Estimates from photos, to document and explain', 'Estimaciones a partir de fotos, para documentar y explicar') }}</span>
      <span class="flex-1" />
      <NuxtLink v-if="can('visit_notes_access')" :to="`/patients/posture/${patientId}`" class="inline-flex h-9 items-center rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-white" data-cy="posture-new">{{ t('New assessment', 'Nueva valoración') }}</NuxtLink>
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

      <section v-if="trend.length > 1" class="rounded-card border border-line bg-surface p-3.5" data-pdf-block="image" data-pdf-span="12">
        <h4 class="text-[13.5px] font-semibold text-ink-900">{{ t('Head ahead of the shoulder, by assessment (cm)', 'Cabeza por delante del hombro, por valoración (cm)') }}</h4>
        <svg :viewBox="`0 0 ${W} ${TH}`" class="mt-2 block h-auto w-full" role="img" :aria-label="t(`From ${trend[0]!.v} to ${trend[trend.length - 1]!.v} cm`, `De ${trend[0]!.v} a ${trend[trend.length - 1]!.v} cm`)" data-cy="posture-trend">
          <polyline :points="trendPts.map((p) => `${p.x},${p.y}`).join(' ')" fill="none" class="stroke-brand" stroke-width="2.5" stroke-linejoin="round" />
          <g v-for="p in trendPts" :key="p.p.a.id">
            <circle :cx="p.x" :cy="p.y" r="4.5" class="fill-surface stroke-brand" stroke-width="2" />
            <text :x="p.x" :y="p.y - 9" text-anchor="middle" class="fill-ink-700 font-mono" font-size="11">{{ num(p.p.v) }}</text>
            <text :x="p.x" :y="TH - 6" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ new Date(p.p.a.taken_at).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) }}</text>
          </g>
        </svg>
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
