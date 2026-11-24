<script setup lang="ts">
import type { MaskMissing, PersonMask } from '../../composables/usePoseModel'
import type { ReportIssue } from '../../utils/reportIssue'
import { personOnWhite, postureJpeg } from '../../utils/postureWhite'
import {
  cutoutVerdict,
  defaultPoints,
  hasQAngle,
  measureAll,
  measureView,
  pointsFromLandmarks,
  postureCanSave,
  postureMissing,
  postureCallouts,
  POSTURE_VIEWS,
  Q_POINTS,
  qAngleDefaults,
  straighten,
  VIEW_LABELS,
  type FrontMetrics,
  type Points,
  type SideMetrics,
  type StoredView,
} from '../../utils/posture'
import {
  isSquatView,
  measureSquat,
  SQUAT_ANGLE_LABELS,
  SQUAT_VIEW_LABELS,
  squatCallouts,
  squatDefaultPoints,
  squatPlane,
  squatPointsFromLandmarks,
  squatPxPerCm,
  squatViewsFor,
  type PhotoView,
  type SquatAngles,
  type SquatFrontMetrics,
  type SquatSideMetrics,
  type SquatViews,
} from '../../utils/squat'

// A new posture or squat assessment for one patient (posture_assessments,
// `kind`). Posture: a photo per view -- front, right side, back, and the left
// side if wanted. Any one of them is enough (postureCanSave); a plane left
// out takes its measurements with it, and the result says which. Squat (utils/squat.ts): the patient standing and at the
// lowest point of a squat, from the front, the side or both. Either way the
// points are placed by the pose model running here in the browser
// (usePoseModel), dragged into place by the practitioner, and the
// measurements are live beside them. Saved together at the end: the photos to
// the clinic's patient-files, then one row. Estimates for documenting, not a
// diagnosis.
//
// The camera's level: on a phone or iPad the device's own sensor reads how
// far it is off straight (useDeviceLevel), and the photo taken then is
// corrected by that much; any photo can be corrected by hand against
// something in the room known to be vertical.
//
// Shared by the web (/patients/posture/<id>) and the staff app, which takes
// the photos with the phone's or iPad's camera, or picks them from the photo
// library. So it is told who is taking it rather than reading
// the web's account store, which the app does not load, and its imports are
// relative: in the app, ~ is mobile/.
const props = withDefaults(defineProps<{ patientId: string; accountId: string; teamMemberId: string | null; kind?: 'posture' | 'squat' }>(), { kind: 'posture' })
const emit = defineEmits<{ saved: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const { detect, warm } = usePoseModel()
const level = useDeviceLevel()
const reportIssue = (useNuxtApp() as unknown as { $reportIssue?: ReportIssue }).$reportIssue
const patientId = props.patientId
const isSquat = props.kind === 'squat'

const height = ref<number | ''>('')
const ready = ref(false)
// The last assessment's height, posture or squat, so a re-assessment does not ask again.
onMounted(async () => {
  // The pose model downloads while the patient gets into place, not after
  // the first photo.
  warm()
  const { data: last } = await supabase.from('posture_assessments').select('height_cm').eq('patient_id', patientId).order('taken_at', { ascending: false }).limit(1).maybeSingle()
  if (last?.height_cm) height.value = Number(last.height_cm)
  ready.value = true
})

// Which photos a squat takes: front and side by default, or one of them.
const angles = ref<SquatAngles>('both')
const steps = computed<PhotoView[]>(() => (isSquat ? squatViewsFor(angles.value) : POSTURE_VIEWS))
const label = (v: PhotoView) => (isSquatView(v) ? t(SQUAT_VIEW_LABELS[v].en, SQUAT_VIEW_LABELS[v].es) : VIEW_LABELS[v])
const optional = (v: PhotoView) => v === 'left'

// A photo is kept both ways when the person could be cut out: as taken, and
// on white. White is what is shown and saved unless the practitioner turns it
// off for that photo (the outline missed a hand, say).
interface Version { url: string; blob: Blob }
// Why a photo has no white version, when it has none -- said under the photo
// so the next one can be taken differently, and reported (noCutout), since
// it used to fail with nothing on screen and nothing anywhere else.
type NoCutout = MaskMissing | 'too-small' | 'too-large' | 'bad-size' | 'failed'
interface Shot {
  original: Version
  cutout: Version | null
  noCutout: NoCutout | null
  white: boolean
  width: number
  height: number
  points: Points
  facing: 'right' | 'left' | null
  found: boolean
  /** Degrees the camera was off straight (utils/posture.ts straighten), and where that came from. */
  tilt: number
  tiltFrom: 'sensor' | 'hand' | null
}
const shown = (s: Shot): Version => (s.white && s.cutout ? s.cutout : s.original)
const shots = reactive<Partial<Record<PhotoView, Shot>>>({})
const step = ref<PhotoView | 'result'>(steps.value[0]!)
watch(steps, (list) => {
  if (step.value !== 'result' && !list.includes(step.value)) step.value = list[0]!
})
const busy = ref(false)
const error = ref('')
// Two inputs, because one cannot offer both on a phone: `capture` sends iOS
// and Android straight to the camera with no way to the photo library, and
// without it Android's WebView offers files only. The camera button shows on
// touch devices; a desktop's file picker is the gallery.
const input = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const touch = useMediaQuery('(pointer: coarse)')

// The level read when "Take photo" was pressed, for the photo that comes back.
let pendingTilt: number | null = null
function openCamera() {
  pendingTilt = level.active.value ? (level.reading.value?.tilt ?? null) : null
  cameraInput.value?.click()
}
function openGallery() {
  pendingTilt = null
  input.value?.click()
}
// A level within half a degree reads as straight; past two the photo is
// visibly off, and past five leaning forward or back the vertical lines
// converge in a way no turning undoes.
const levelState = computed(() => {
  const r = level.reading.value
  if (!r) return null
  const n = (x: number) => x.toLocaleString(t('en-GB', 'es-ES'))
  return { ...r, straight: Math.abs(r.tilt) < 0.5, off: Math.abs(r.tilt) >= 2, leaning: r.pitch >= 5, turned: n(Math.abs(r.tilt)), lean: n(r.pitch) }
})

// The photo, shrunk to 1600 px on its long side (enough to place a point to
// a few millimetres, small enough to upload from a phone), as a JPEG.
const jpeg = postureJpeg
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { blob: await jpeg(canvas), width: canvas.width, height: canvas.height, canvas }
}

// The person on white (utils/postureWhite.ts), once cutoutVerdict
// (utils/posture.ts) believes the outline is one standing person.

function forget(s: Shot | undefined) {
  if (!s) return
  URL.revokeObjectURL(s.original.url)
  if (s.cutout) URL.revokeObjectURL(s.cutout.url)
}
onBeforeUnmount(() => Object.values(shots).forEach((s) => forget(s)))

async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || step.value === 'result') return
  const view = step.value
  const tilt = pendingTilt
  pendingTilt = null
  busy.value = true
  error.value = ''
  try {
    const { blob, width, height: h, canvas } = await shrink(file)
    const { landmarks, mask, missing, delegate } = await detect(canvas)
    const placed = isSquatView(view)
      ? landmarks ? squatPointsFromLandmarks(view, landmarks, width, h) : squatDefaultPoints(view, width, h)
      : landmarks ? pointsFromLandmarks(view, landmarks, width, h) : defaultPoints(view, width, h)
    let noCutout: NoCutout | null = missing
    let share: number | null = null
    let cutBlob: Blob | null = null
    if (mask) {
      const verdict = cutoutVerdict(mask)
      share = verdict.share
      if (verdict.verdict !== 'ok') noCutout = verdict.verdict
      else {
        try {
          cutBlob = await jpeg(personOnWhite(canvas, mask))
        } catch (e) {
          console.error('[posture] cut out', e)
          noCutout = 'failed'
        }
      }
    }
    if (noCutout) {
      reportIssue?.(`Posture photo kept with its background: ${noCutout}`, {
        // A photo the person filled, or stood far from, is the photo; the
        // rest is the device or the model, which is what this is here to find.
        level: noCutout === 'too-small' || noCutout === 'too-large' || noCutout === 'no-person' ? 'info' : 'warning',
        tags: { posture_cutout: noCutout, posture_view: view, posture_kind: props.kind, pose_delegate: delegate ?? 'none', mask_size: mask ? `${mask.width}x${mask.height}` : 'none', person_share: share === null ? 'none' : String(share) },
        fingerprint: ['posture-cutout', noCutout],
      })
    }
    forget(shots[view])
    shots[view] = {
      original: { url: URL.createObjectURL(blob), blob },
      cutout: cutBlob ? { url: URL.createObjectURL(cutBlob), blob: cutBlob } : null,
      noCutout: cutBlob ? null : noCutout,
      white: !!cutBlob,
      width,
      height: h,
      points: placed.points,
      facing: placed.facing,
      found: !!landmarks,
      tilt: tilt ?? 0,
      tiltFrom: tilt === null ? null : 'sensor',
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

// No-person is already said by the line above the points.
function noCutoutText(reason: NoCutout): string {
  if (reason === 'too-small') return t('The background could not be removed: the person is too small in the photo. Step closer, keeping head to feet in.', 'No se ha podido quitar el fondo: la persona sale muy pequeña. Acércate un poco, sin cortar cabeza ni pies.')
  if (reason === 'too-large') return t('The background could not be removed: the person fills almost the whole photo. Step back so some wall shows around them.', 'No se ha podido quitar el fondo: la persona ocupa casi toda la foto. Aléjate un poco para que se vea pared alrededor.')
  return t('The background could not be removed on this device, so the photo stays as taken. The points and measurements are not affected.', 'No se ha podido quitar el fondo en este dispositivo, así que la foto queda como se hizo. Los puntos y las medidas no cambian.')
}

const current = computed(() => (step.value === 'result' ? null : shots[step.value] ?? null))
const heightOk = computed(() => typeof height.value === 'number' && height.value >= 50 && height.value <= 250)
const stored = (s: Shot): StoredView => ({ photo: '', width: s.width, height: s.height, points: s.points, facing: s.facing, tilt: s.tilt || null })
const squatViews = computed<SquatViews>(() => Object.fromEntries(Object.entries(shots).filter(([v]) => isSquatView(v)).map(([v, s]) => [v, stored(s!)])))
const squatLive = computed(() => (isSquat && heightOk.value ? measureSquat(squatViews.value, Number(height.value)) : null))
const live = computed(() => (current.value && heightOk.value && step.value !== 'result' && !isSquatView(step.value) ? measureView(step.value, current.value.points, Number(height.value), current.value.facing, current.value.tilt || null) : null))
const isSide = computed(() => step.value === 'right' || step.value === 'left')
const sideLive = computed(() => (isSide.value ? (live.value as SideMetrics | null) : null))
const frontLive = computed(() => (!isSide.value ? (live.value as FrontMetrics | null) : null))
const squatFrontLive = computed(() => (step.value !== 'result' && isSquatView(step.value) && squatPlane(step.value) === 'front' ? ((squatLive.value?.[step.value] as SquatFrontMetrics | undefined) ?? null) : null))
const squatSideLive = computed(() => (step.value !== 'result' && isSquatView(step.value) && squatPlane(step.value) === 'side' ? ((squatLive.value?.[step.value] as SquatSideMetrics | undefined) ?? null) : null))
const next = computed<PhotoView | 'result'>(() => {
  if (step.value === 'result') return 'result'
  const i = steps.value.indexOf(step.value)
  return steps.value[i + 1] ?? 'result'
})
const taken = computed(() => steps.value.filter((v) => shots[v]))
// Planes with no photo (postureMissing), each said on the result with what it takes away.
const missing = computed(() => (isSquat ? [] : postureMissing(shots)))
const canFinish = computed(() => heightOk.value && (isSquat ? steps.value.every((v) => shots[v]) : postureCanSave(shots)))
// Any view can be left out: skipping moves on to the next one.
const canSkipView = computed(() => !isSquat && step.value !== 'result' && !shots[step.value] && next.value !== 'result')
const planeLabel = (p: 'frontal' | 'side') => (p === 'frontal' ? t('Front or back', 'Frente o espalda') : t('Side', 'Lado'))

// The measurements written on the photo beside their points, when asked for.
const showValues = ref(false)
function calloutsFor(v: PhotoView, s: Shot) {
  if (!heightOk.value) return null
  if (!isSquatView(v)) return postureCallouts(v, s.points, Number(height.value), s.facing, s.tilt || null)
  const plane = squatPlane(v)
  const up = shots[plane === 'front' ? 'front_up' : 'side_up']
  const k = squatPxPerCm(up ? stored(up) : undefined, plane, Number(height.value))
  return squatCallouts(v, s.points, k, s.facing, s.tilt || null, up ? straighten(up.points, up.tilt || null) : null)
}
const currentCallouts = computed(() => (showValues.value && current.value && step.value !== 'result' ? calloutsFor(step.value, current.value) : null))

// The Q-angle, on the front photo of a posture assessment, when asked for.
function addQAngle() {
  if (current.value && step.value === 'front') current.value.points = { ...current.value.points, ...qAngleDefaults(current.value.points) }
}
function removeQAngle() {
  if (!current.value) return
  current.value.points = Object.fromEntries(Object.entries(current.value.points).filter(([k]) => !Q_POINTS.includes(k))) as Points
}
function setTilt(value: number) {
  if (!current.value) return
  current.value.tilt = Math.round(value * 10) / 10
  current.value.tiltFrom = 'hand'
}

const notes = ref('')
const saving = ref(false)
async function save() {
  if (!canFinish.value) return
  saving.value = true
  error.value = ''
  try {
    const id = crypto.randomUUID()
    const views: Record<string, StoredView> = {}
    for (const v of taken.value) {
      const s = shots[v]!
      const path = `${props.accountId}/posture/${id}/${v}.jpg`
      const { error: up } = await supabase.storage.from('patient-files').upload(path, shown(s).blob, { contentType: 'image/jpeg', upsert: true })
      if (up) throw new Error(up.message)
      views[v] = { photo: path, width: s.width, height: s.height, points: s.points, facing: s.facing, ...(s.tilt ? { tilt: s.tilt } : {}) }
    }
    const metrics = isSquat ? measureSquat(views as SquatViews, Number(height.value)) : measureAll(views, Number(height.value))
    const { error: insertError } = await supabase.from('posture_assessments').insert({
      id,
      account_id: props.accountId,
      patient_id: patientId,
      taken_by: props.teamMemberId,
      kind: props.kind,
      height_cm: Number(height.value),
      views: views as never,
      metrics: metrics as never,
      notes: notes.value.trim() || null,
    })
    if (insertError) throw new Error(insertError.message)
    emit('saved')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
const fmt = (n: number | null | undefined, unit: string) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-ES')} ${unit}`)
const row = 'flex justify-between gap-3 border-b border-line-row py-2 text-[13.5px]'
</script>

<template>
  <div data-cy="posture-capture" :data-step="step" :data-kind="kind" :data-ready="ready ? 'true' : undefined">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2" role="tablist">
        <button
          v-for="v in steps"
          :key="v"
          type="button"
          role="tab"
          :aria-selected="step === v"
          class="h-9 rounded-pill border px-3.5 text-[13px] font-semibold touch:h-11"
          :class="step === v ? 'border-brand bg-brand-tint text-brand-text' : shots[v] ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control bg-surface text-ink-700'"
          :data-cy="`posture-step-${v}`"
          @click="step = v"
        >
          {{ shots[v] ? '✓ ' : '' }}{{ label(v) }}{{ optional(v) ? t(' (optional)', ' (opcional)') : '' }}
        </button>
        <button type="button" role="tab" :aria-selected="step === 'result'" :disabled="!canFinish" class="h-9 rounded-pill border border-line-control bg-surface px-3.5 text-[13px] font-semibold text-ink-700 disabled:opacity-50 touch:h-11" data-cy="posture-step-result" @click="step = 'result'">{{ t('Result', 'Resultado') }}</button>
        <span class="flex-1" />
        <label v-if="isSquat" class="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
          {{ t('Photos', 'Fotos') }}
          <select v-model="angles" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] touch:h-11" data-cy="squat-angles">
            <option v-for="(l, k) in SQUAT_ANGLE_LABELS" :key="k" :value="k">{{ t(l.en, l.es) }}</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
          {{ t('Height', 'Altura') }}
          <input v-model.number="height" type="number" min="50" max="250" class="h-9 w-[84px] rounded-ctl border border-line-control bg-surface px-2.5 font-mono text-[14px] touch:h-11" :class="heightOk ? '' : 'border-warning-border'" data-cy="posture-height" />
          cm
        </label>
      </div>
      <p v-if="!isSquat" class="text-[12.5px] text-ink-muted" data-cy="posture-views-hint">{{ t('Any one photo is enough. The side gives the head and the vertical; the front or the back gives tilts, shifts and knees (the Q-angle only from the front). The alignment index needs both.', 'Basta con una foto. La de lado da la cabeza y la vertical; la de frente o espalda, inclinaciones, desplazamientos y rodillas (el ángulo Q, solo la de frente). El índice de alineación necesita las dos.') }}</p>
      <p v-if="!heightOk" class="text-[12.5px] text-warning-text">{{ t("The patient's height turns pixels into centimetres.", 'La altura del paciente es lo que pasa los píxeles a centímetros.') }}</p>
      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <input ref="input" type="file" accept="image/*" class="hidden" data-cy="posture-file" @change="onPhoto" />
      <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" data-cy="posture-camera-file" @change="onPhoto" />

      <template v-if="step !== 'result'">
        <div v-if="!current" class="flex flex-col items-center gap-4 rounded-card border border-dashed border-line-control bg-surface p-8 text-center">
          <p class="text-[15px] font-semibold text-ink-900">{{ t(`Photo: ${label(step)}`, `Foto: ${label(step).toLowerCase()}`) }}</p>
          <ul v-if="!isSquat" class="max-w-[520px] list-disc pl-5 text-left text-[13.5px] leading-relaxed text-ink-700">
            <li>{{ t('Standing, relaxed, arms by the sides, feet hip-width apart, barefoot if possible.', 'De pie, relajado, brazos a los lados, pies a la anchura de las caderas, descalzo si puede ser.') }}</li>
            <li>{{ t('Whole body in the picture, head to feet, against a plain wall.', 'Todo el cuerpo en la foto, de la cabeza a los pies, contra una pared lisa.') }}</li>
            <li>{{ t('Camera upright at hip height, 2–3 m away, the same place every time.', 'Cámara vertical a la altura de la cadera, a 2–3 m, siempre en el mismo sitio.') }}</li>
          </ul>
          <ul v-else class="max-w-[520px] list-disc pl-5 text-left text-[13.5px] leading-relaxed text-ink-700" data-cy="squat-instructions">
            <li v-if="step.endsWith('up')">{{ t('Standing, feet shoulder-width apart, barefoot, arms straight out in front.', 'De pie, pies a la anchura de los hombros, descalzo, brazos estirados al frente.') }}</li>
            <li v-else>{{ t('Squat as low as is comfortable, without pain, and hold the bottom for two seconds while the photo is taken.', 'Que baje todo lo que pueda sin dolor y aguante dos segundos abajo mientras se hace la foto.') }}</li>
            <li>{{ t('Whole body in the picture, head to feet, against a plain wall.', 'Todo el cuerpo en la foto, de la cabeza a los pies, contra una pared lisa.') }}</li>
            <li>{{ t('The camera stays in the same place for the standing and the bottom photo, at hip height: the standing one is what scales the other.', 'La cámara no se mueve entre la foto de pie y la de abajo, a la altura de la cadera: la de pie es la que da la escala a la otra.') }}</li>
          </ul>
          <div v-if="touch" class="flex flex-col items-center gap-1.5" data-cy="posture-level">
            <button v-if="!level.active.value" type="button" class="inline-flex h-11 items-center rounded-ctl border border-line-control px-3.5 text-[13px] font-semibold text-ink-700" data-cy="posture-level-start" @click="level.start()">{{ t('Check the camera is level', 'Comprobar el nivel de la cámara') }}</button>
            <p v-else-if="levelState" class="rounded-pill px-3 py-1.5 text-[13px] font-semibold" :class="levelState.straight ? 'bg-success-bg text-success-text' : levelState.off ? 'bg-warning-bg text-warning-text' : 'bg-surface-subtle text-ink-700'" data-cy="posture-level-reading">
              {{ levelState.straight ? t('Camera straight', 'Cámara recta') : t(`Camera turned ${levelState.turned}°`, `Cámara girada ${levelState.turned}°`) }}<template v-if="levelState.leaning"> · {{ t(`leaning ${levelState.lean}°`, `inclinada ${levelState.lean}°`) }}</template>
            </p>
            <p v-else class="text-[12.5px] text-ink-muted">{{ level.denied.value ? t('The level needs motion access, which was not allowed.', 'El nivel necesita acceso al movimiento, y no se ha permitido.') : t('Waiting for the level… hold the device upright.', 'Esperando al nivel… pon el dispositivo en vertical.') }}</p>
            <p v-if="level.active.value" class="max-w-[420px] text-[12px] text-ink-muted">{{ t('The photo is corrected by however far the camera is turned when you press Take photo.', 'La foto se corrige con lo que esté girada la cámara al pulsar Hacer foto.') }}</p>
          </div>
          <p v-if="busy" class="text-[13.5px] font-semibold text-ink-700" data-cy="posture-busy">{{ t('Finding the points…', 'Buscando los puntos…') }}</p>
          <div v-else class="flex flex-wrap justify-center gap-2">
            <UiBtn v-if="touch" variant="primary" data-cy="posture-camera" @click="openCamera">{{ t('Take photo', 'Hacer foto') }}</UiBtn>
            <UiBtn :variant="touch ? undefined : 'primary'" data-cy="posture-take" @click="openGallery">{{ touch ? t('Choose from gallery', 'Elegir de la galería') : t('Choose photo', 'Elegir foto') }}</UiBtn>
          </div>
          <button v-if="canSkipView" type="button" class="text-[13px] font-semibold text-ink-muted" data-cy="posture-skip-view" @click="step = next">{{ t('Skip this view', 'Saltar esta vista') }}</button>
          <button v-if="!isSquat && canFinish" type="button" class="text-[13px] font-semibold text-ink-muted" data-cy="posture-skip" @click="step = 'result'">{{ t('Skip to the result', 'Saltar al resultado') }}</button>
          <p v-else-if="!isSquat && step === 'left' && heightOk" class="text-[12.5px] text-warning-text" data-cy="posture-missing">{{ t('The result needs at least one photo.', 'Para ver el resultado hace falta al menos una foto.') }}</p>
        </div>
        <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div class="mx-auto w-full max-w-[560px]">
            <PostureOverlay :src="shown(current).url" :width="current.width" :height="current.height" :view="step" :points="current.points" :tilt="current.tilt || null" :callouts="currentCallouts" editable @update:points="current.points = $event" />
            <p class="mt-2 text-center text-[12.5px] text-ink-muted" data-cy="posture-found" :data-found="current.found ? 'true' : 'false'">
              {{ current.found ? t('Drag a point to correct it. The blue line is the vertical from the ankle.', 'Arrastra un punto para corregirlo. La línea azul es la vertical desde el tobillo.') : t('No one found automatically: drag each point onto the body.', 'No se ha encontrado a nadie automáticamente: arrastra cada punto a su sitio.') }}
            </p>
            <div class="mx-auto mt-2 flex w-fit flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              <label v-if="current.cutout" class="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-700">
                <input v-model="current.white" type="checkbox" class="size-4 accent-brand" data-cy="posture-white" />
                {{ t('White background', 'Fondo blanco') }}
              </label>
              <label class="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-700">
                <input v-model="showValues" type="checkbox" class="size-4 accent-brand" data-cy="posture-values" />
                {{ t('Values on the photo', 'Valores en la foto') }}
              </label>
              <template v-if="step === 'front'">
                <button v-if="!hasQAngle(current.points)" type="button" class="h-9 text-[13px] font-semibold text-brand-text touch:h-11" data-cy="posture-q-add" @click="addQAngle">{{ t('+ Q-angle', '+ Ángulo Q') }}</button>
                <button v-else type="button" class="h-9 text-[13px] font-semibold text-ink-muted touch:h-11" data-cy="posture-q-remove" @click="removeQAngle">{{ t('Remove Q-angle', 'Quitar ángulo Q') }}</button>
              </template>
            </div>
            <p v-if="!current.cutout && current.noCutout && current.noCutout !== 'no-person'" class="mt-2 text-center text-[12.5px] text-ink-muted" data-cy="posture-no-cutout" :data-reason="current.noCutout">
              {{ noCutoutText(current.noCutout) }}
            </p>
            <p v-if="step === 'front' && hasQAngle(current.points)" class="mt-1 text-center text-[12.5px] text-ink-muted">{{ t('Drag the new points onto the iliac spine, the middle of the kneecap and the tibial tuberosity of each leg (green line).', 'Arrastra los puntos nuevos a la espina ilíaca, el centro de la rótula y la tuberosidad tibial de cada pierna (línea verde).') }}</p>
            <div class="mt-3 rounded-ctl border border-line bg-surface px-3 py-2.5" data-cy="posture-tilt">
              <label class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-ink-700">
                <span>{{ t('Camera tilt', 'Inclinación de la cámara') }}</span>
                <span class="font-mono" data-cy="posture-tilt-value">{{ current.tilt.toLocaleString('es-ES') }}°</span>
                <span v-if="current.tiltFrom === 'sensor'" class="text-[12px] font-normal text-ink-muted">{{ t("from the device's level", 'del nivel del dispositivo') }}</span>
                <input type="range" min="-10" max="10" step="0.5" :value="current.tilt" class="min-w-[160px] flex-1 accent-brand" :aria-label="t('Camera tilt in degrees', 'Inclinación de la cámara en grados')" data-cy="posture-tilt-range" @input="setTilt(Number(($event.target as HTMLInputElement).value))" />
              </label>
              <p class="mt-1 text-[12px] text-ink-muted">{{ t('If the camera was not straight, turn this until the blue line runs parallel to a door frame or a corner of the room. The measurements follow.', 'Si la cámara no estaba recta, ajústalo hasta que la línea azul vaya paralela a un marco de puerta o una esquina de la sala. Las medidas se corrigen solas.') }}</p>
            </div>
          </div>
          <aside class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4" data-cy="posture-live">
            <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ label(step) }} · {{ t('live', 'al momento') }}</p>
            <template v-if="sideLive">
              <div :class="row"><span>{{ t('Ear ahead of the vertical', 'Oreja por delante de la vertical') }}</span><span class="font-mono" data-cy="posture-live-ear">{{ fmt(sideLive.earForward, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Shoulder', 'Hombro') }}</span><span class="font-mono">{{ fmt(sideLive.shoulderForward, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Hip', 'Cadera') }}</span><span class="font-mono">{{ fmt(sideLive.hipForward, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Knee', 'Rodilla') }}</span><span class="font-mono">{{ fmt(sideLive.kneeForward, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Ear–shoulder angle', 'Ángulo oreja–hombro') }}</span><span class="font-mono" data-cy="posture-live-angle">{{ fmt(sideLive.headAngle, '°') }}</span></div>
              <div :class="row"><span>{{ t('Height the posture takes', 'Altura que resta la postura') }}</span><span class="font-mono" data-cy="posture-live-height-loss">{{ fmt(sideLive.heightLoss, 'cm') }}</span></div>
              <div class="mt-2 rounded-ctl bg-warning-bg p-3">
                <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-warning-text">{{ t('Effective head weight', 'Peso efectivo de la cabeza') }}</p>
                <p class="mt-1 font-mono text-[24px] font-semibold text-ink-900" data-cy="posture-live-weight">{{ fmt(sideLive.headWeight, 'kg') }}</p>
                <p class="text-[12px] text-ink-muted" data-cy="posture-live-neck-load">{{ t(`Estimated from the angle · upright ≈ 5 kg · ${fmt(sideLive.neckLoad, 'kg')} more on the neck`, `Estimado por el ángulo · erguida ≈ 5 kg · ${fmt(sideLive.neckLoad, 'kg')} más sobre el cuello`) }}</p>
              </div>
            </template>
            <template v-else-if="frontLive">
              <div :class="row"><span>{{ t('Head tilt', 'Inclinación de la cabeza') }}</span><span class="font-mono">{{ fmt(frontLive.headTilt, '°') }}</span></div>
              <div :class="row"><span>{{ t('Shoulders', 'Hombros') }}</span><span class="font-mono" data-cy="posture-live-shoulders">{{ fmt(frontLive.shoulderTilt, '°') }}</span></div>
              <div :class="row"><span>{{ t('Pelvis', 'Pelvis') }}</span><span class="font-mono">{{ fmt(frontLive.hipTilt, '°') }}</span></div>
              <div :class="row"><span>{{ t('Head off centre', 'Cabeza desplazada') }}</span><span class="font-mono">{{ fmt(frontLive.headShift, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Shoulders off centre', 'Hombros desplazados') }}</span><span class="font-mono">{{ fmt(frontLive.shoulderShift, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Pelvis off centre', 'Pelvis desplazada') }}</span><span class="font-mono">{{ fmt(frontLive.hipShift, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Knees (R / L)', 'Rodillas (D / I)') }}</span><span class="font-mono" data-cy="posture-live-knees">{{ fmt(frontLive.kneeAngleR, '°') }} / {{ fmt(frontLive.kneeAngleL, '°') }}</span></div>
              <div v-if="frontLive.qAngleR !== undefined" :class="row"><span>{{ t('Q-angle (R / L)', 'Ángulo Q (D / I)') }}</span><span class="font-mono" data-cy="posture-live-q">{{ fmt(frontLive.qAngleR, '°') }} / {{ fmt(frontLive.qAngleL, '°') }}</span></div>
              <p class="text-[12px] text-ink-muted">{{ t("Tilt: + means the patient's right side is lower. Off centre: + is towards their right. Knees: + is inward.", 'Inclinación: + es el lado derecho del paciente más bajo. Desplazado: + hacia su derecha. Rodillas: + hacia dentro.') }}</p>
            </template>
            <template v-else-if="squatFrontLive">
              <div :class="row"><span>{{ t('Right knee inward', 'Rodilla derecha hacia dentro') }}</span><span class="font-mono" data-cy="squat-live-knee-r">{{ fmt(squatFrontLive.kneeInR, '°') }}</span></div>
              <div :class="row"><span>{{ t('Left knee inward', 'Rodilla izquierda hacia dentro') }}</span><span class="font-mono" data-cy="squat-live-knee-l">{{ fmt(squatFrontLive.kneeInL, '°') }}</span></div>
              <div :class="row"><span>{{ t('Pelvis tilted', 'Pelvis inclinada') }}</span><span class="font-mono">{{ fmt(squatFrontLive.pelvisTilt, '°') }}</span></div>
              <div :class="row"><span>{{ t('Pelvis off centre', 'Desplazamiento lateral') }}</span><span class="font-mono" data-cy="squat-live-shift">{{ fmt(squatFrontLive.shiftCm, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Shoulders', 'Hombros') }}</span><span class="font-mono">{{ fmt(squatFrontLive.shoulderTilt, '°') }}</span></div>
              <div :class="row"><span>{{ t('Knees ÷ ankles width', 'Rodillas ÷ tobillos (anchura)') }}</span><span class="font-mono">{{ fmt(squatFrontLive.kneeWidth, '') }}</span></div>
              <div :class="row"><span>{{ t('Weight over the right foot', 'Peso sobre el pie derecho') }}</span><span class="font-mono">{{ fmt(squatFrontLive.rightShare, '%') }}</span></div>
              <p class="text-[12px] text-ink-muted">{{ t('Knees: + is inward, off the hip–ankle line. Pelvis: + is the right side lower, or shifted to the right. Centimetres need the standing photo.', 'Rodillas: + hacia dentro, respecto a la línea cadera–tobillo. Pelvis: + es el lado derecho más bajo, o desplazada a la derecha. Los centímetros necesitan la foto de pie.') }}</p>
            </template>
            <template v-else-if="squatSideLive">
              <div :class="row"><span>{{ t('Knee angle', 'Ángulo de rodilla') }}</span><span class="font-mono" data-cy="squat-live-knee-angle">{{ fmt(squatSideLive.kneeAngle, '°') }}</span></div>
              <div :class="row"><span>{{ t('Hip angle', 'Ángulo de cadera') }}</span><span class="font-mono">{{ fmt(squatSideLive.hipAngle, '°') }}</span></div>
              <div :class="row"><span>{{ t('Trunk lean', 'Inclinación del tronco') }}</span><span class="font-mono" data-cy="squat-live-trunk">{{ fmt(squatSideLive.trunkLean, '°') }}</span></div>
              <div :class="row"><span>{{ t('Shin lean', 'Inclinación de la tibia') }}</span><span class="font-mono">{{ fmt(squatSideLive.tibiaLean, '°') }}</span></div>
              <div :class="row"><span>{{ t('Trunk against shin', 'Tronco frente a tibia') }}</span><span class="font-mono">{{ fmt(squatSideLive.trunkVsTibia, '°') }}</span></div>
              <div :class="row"><span>{{ t('Hip below the knee', 'Cadera por debajo de la rodilla') }}</span><span class="font-mono">{{ squatSideLive.hipBelowKnee ? t('yes', 'sí') : t('no', 'no') }}</span></div>
              <div :class="row"><span>{{ t('Heel lift', 'Talón levantado') }}</span><span class="font-mono">{{ fmt(squatSideLive.heelLift, 'cm') }}</span></div>
              <div :class="row"><span>{{ t('Knee ahead of the toes', 'Rodilla por delante de la punta del pie') }}</span><span class="font-mono">{{ fmt(squatSideLive.kneePastToe, 'cm') }}</span></div>
              <p class="text-[12px] text-ink-muted">{{ t('Knee angle: 180° is straight; the smaller, the deeper. Leans are from vertical, forward.', 'Ángulo de rodilla: 180° es recta; cuanto más pequeño, más profunda. Las inclinaciones son desde la vertical, hacia delante.') }}</p>
            </template>
            <p v-else class="text-[13px] text-ink-muted">{{ t('Enter the height to see measurements.', 'Pon la altura para ver las medidas.') }}</p>
            <div class="mt-auto flex gap-2 pt-3">
              <UiBtn class="flex-1" :disabled="busy" data-cy="posture-retake" @click="touch ? openCamera() : openGallery()">{{ t('Retake', 'Repetir foto') }}</UiBtn>
              <UiBtn v-if="touch" class="flex-1" :disabled="busy" data-cy="posture-regallery" @click="openGallery">{{ t('Gallery', 'Galería') }}</UiBtn>
              <UiBtn class="flex-1" variant="primary" :disabled="next === 'result' && !canFinish" data-cy="posture-next" @click="step = next">{{ next === 'result' ? t('See result', 'Ver resultado') : t(`Next: ${label(next).toLowerCase()}`, `Siguiente: ${label(next).toLowerCase()}`) }}</UiBtn>
            </div>
            <button v-if="!isSquat && canFinish && next !== 'result'" type="button" class="text-[12.5px] font-semibold text-ink-muted" data-cy="posture-skip" @click="step = 'result'">{{ t('Skip to the result', 'Saltar al resultado') }}</button>
          </aside>
        </div>
      </template>

      <section v-else class="flex flex-col gap-4" data-cy="posture-result">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div v-for="v in taken" :key="v" class="flex flex-col gap-1">
            <PostureOverlay :src="shown(shots[v]!).url" :width="shots[v]!.width" :height="shots[v]!.height" :view="v" :points="shots[v]!.points" :tilt="shots[v]!.tilt || null" :labels="false" />
            <span class="text-center text-[12.5px] font-semibold text-ink-700">{{ label(v) }}</span>
          </div>
          <!-- A plane left out: said, not just absent. -->
          <div v-for="p in missing" :key="p" class="flex flex-col gap-1" :data-cy="`posture-view-missing-${p}`">
            <div class="flex aspect-[3/5] items-center justify-center rounded-ctl border border-dashed border-line-control bg-surface-subtle px-3 text-center text-[12.5px] text-ink-muted">{{ t('Not taken', 'No tomada') }}</div>
            <span class="text-center text-[12.5px] font-semibold text-ink-muted">{{ planeLabel(p) }}</span>
          </div>
        </div>
        <ul v-if="!isSquat && (missing.length || (!shots.front && shots.back))" class="flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-ink-muted" data-cy="posture-unavailable">
          <li v-if="missing.includes('frontal')" data-cy="posture-no-frontal-note">{{ t('No front or back photo: no shoulder or pelvis tilt, no sideways shift, no knees and no right–left weight split.', 'Sin foto de frente ni de espalda: no hay inclinación de hombros ni de pelvis, desplazamiento lateral, rodillas ni reparto de peso derecha–izquierda.') }}</li>
          <li v-if="missing.includes('side')" data-cy="posture-no-side-note">{{ t('No side photo: no head-forward measurement, head weight or distances from the vertical.', 'Sin foto de lado: no hay cabeza adelantada, peso de la cabeza ni distancias a la vertical.') }}</li>
          <li v-if="missing.length" data-cy="posture-no-index-note">{{ t('The alignment index needs a side photo and a front or back one.', 'El índice de alineación necesita una foto de lado y una de frente o de espalda.') }}</li>
          <li v-if="!shots.front && shots.back" data-cy="posture-no-front-note">{{ t('No front photo: the frontal measurements come from the back, and there is no Q-angle.', 'Sin foto de frente: las medidas frontales salen de la espalda y no hay ángulo Q.') }}</li>
        </ul>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Notes (optional)', 'Notas (opcional)') }}
          <textarea v-model="notes" rows="2" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal" data-cy="posture-notes" />
        </label>
        <div class="flex gap-2">
          <UiBtn variant="primary" :disabled="saving || !canFinish" data-cy="posture-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save assessment', 'Guardar valoración') }}</UiBtn>
          <span class="self-center text-[12.5px] text-ink-muted">{{ (taken.length === 1 ? t('1 photo', '1 foto') : t(`${taken.length} photos`, `${taken.length} fotos`)) }}</span>
        </div>
      </section>
    </div>
  </div>
</template>
