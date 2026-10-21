<script setup lang="ts">
import { measureAll, measureView, defaultPoints, pointsFromLandmarks, POSTURE_VIEWS, VIEW_LABELS, type FrontMetrics, type Points, type PostureView, type SideMetrics, type StoredViews } from '../../utils/posture'

// A new posture assessment for one patient (posture_assessments): a photo per
// view -- front, right side, back, and the left side if wanted -- the points
// placed by the pose model running here in the browser (usePoseModel), dragged
// into place by the practitioner, and the measurements live beside them
// (utils/posture.ts). Saved together at the end: the photos to the clinic's
// patient-files, then one row. Estimates for documenting, not a diagnosis.
//
// Shared by the web (/patients/posture/<id>) and the staff app, which takes
// the photos with the phone's or iPad's camera, or picks them from the photo
// library. So it is told who is taking it rather than reading
// the web's account store, which the app does not load, and its imports are
// relative: in the app, ~ is mobile/.
const props = defineProps<{ patientId: string; accountId: string; teamMemberId: string | null }>()
const emit = defineEmits<{ saved: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const { detect, warm } = usePoseModel()
const patientId = props.patientId

const height = ref<number | ''>('')
const ready = ref(false)
// The last assessment's height, so a re-assessment does not ask again.
onMounted(async () => {
  // The pose model downloads while the patient gets into place, not after
  // the first photo.
  warm()
  const { data: last } = await supabase.from('posture_assessments').select('height_cm').eq('patient_id', patientId).order('taken_at', { ascending: false }).limit(1).maybeSingle()
  if (last?.height_cm) height.value = Number(last.height_cm)
  ready.value = true
})

interface Shot { url: string; blob: Blob; width: number; height: number; points: Points; facing: 'right' | 'left' | null; found: boolean }
const shots = reactive<Partial<Record<PostureView, Shot>>>({})
const step = ref<PostureView | 'result'>('front')
const busy = ref(false)
const error = ref('')
// Two inputs, because one cannot offer both on a phone: `capture` sends iOS
// and Android straight to the camera with no way to the photo library, and
// without it Android's WebView offers files only. The camera button shows on
// touch devices; a desktop's file picker is the gallery.
const input = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const touch = useMediaQuery('(pointer: coarse)')

// The photo, shrunk to 1600 px on its long side (enough to place a point to
// a few millimetres, small enough to upload from a phone), as a JPEG.
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se ha podido leer la foto'))), 'image/jpeg', 0.86))
  return { blob, width: canvas.width, height: canvas.height, canvas }
}

async function onPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || step.value === 'result') return
  const view = step.value
  busy.value = true
  error.value = ''
  try {
    const { blob, width, height: h, canvas } = await shrink(file)
    const landmarks = await detect(canvas)
    const placed = landmarks ? pointsFromLandmarks(view, landmarks, width, h) : defaultPoints(view, width, h)
    if (shots[view]) URL.revokeObjectURL(shots[view]!.url)
    shots[view] = { url: URL.createObjectURL(blob), blob, width, height: h, points: placed.points, facing: placed.facing, found: !!landmarks }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const current = computed(() => (step.value === 'result' ? null : shots[step.value] ?? null))
const heightOk = computed(() => typeof height.value === 'number' && height.value >= 50 && height.value <= 250)
const live = computed(() => (current.value && heightOk.value && step.value !== 'result' ? measureView(step.value, current.value.points, Number(height.value), current.value.facing) : null))
const isSide = computed(() => step.value === 'right' || step.value === 'left')
const sideLive = computed(() => (isSide.value ? (live.value as SideMetrics | null) : null))
const frontLive = computed(() => (!isSide.value ? (live.value as FrontMetrics | null) : null))
const nextOf: Record<PostureView, PostureView | 'result'> = { front: 'right', right: 'back', back: 'left', left: 'result' }
const next = computed<PostureView | 'result'>(() => (step.value === 'result' ? 'result' : nextOf[step.value]))
const taken = computed(() => POSTURE_VIEWS.filter((v) => shots[v]))
const canFinish = computed(() => heightOk.value && !!shots.front && (!!shots.right || !!shots.left))

const notes = ref('')
const saving = ref(false)
async function save() {
  if (!canFinish.value) return
  saving.value = true
  error.value = ''
  try {
    const id = crypto.randomUUID()
    const views: StoredViews = {}
    for (const v of taken.value) {
      const s = shots[v]!
      const path = `${props.accountId}/posture/${id}/${v}.jpg`
      const { error: up } = await supabase.storage.from('patient-files').upload(path, s.blob, { contentType: 'image/jpeg', upsert: true })
      if (up) throw new Error(up.message)
      views[v] = { photo: path, width: s.width, height: s.height, points: s.points, facing: s.facing }
    }
    const { error: insertError } = await supabase.from('posture_assessments').insert({
      id,
      account_id: props.accountId,
      patient_id: patientId,
      taken_by: props.teamMemberId,
      height_cm: Number(height.value),
      views: views as never,
      metrics: measureAll(views, Number(height.value)) as never,
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
</script>

<template>
  <div data-cy="posture-capture" :data-step="step" :data-ready="ready ? 'true' : undefined">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2" role="tablist">
        <button
          v-for="v in POSTURE_VIEWS"
          :key="v"
          type="button"
          role="tab"
          :aria-selected="step === v"
          class="h-9 rounded-pill border px-3.5 text-[13px] font-semibold"
          :class="step === v ? 'border-brand bg-brand-tint text-brand-text' : shots[v] ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control bg-surface text-ink-700'"
          :data-cy="`posture-step-${v}`"
          @click="step = v"
        >
          {{ shots[v] ? '✓ ' : '' }}{{ VIEW_LABELS[v] }}{{ v === 'left' ? t(' (optional)', ' (opcional)') : '' }}
        </button>
        <button type="button" role="tab" :aria-selected="step === 'result'" :disabled="!canFinish" class="h-9 rounded-pill border border-line-control bg-surface px-3.5 text-[13px] font-semibold text-ink-700 disabled:opacity-50" data-cy="posture-step-result" @click="step = 'result'">{{ t('Result', 'Resultado') }}</button>
        <span class="flex-1" />
        <label class="flex items-center gap-2 text-[13px] font-semibold text-ink-700">
          {{ t('Height', 'Altura') }}
          <input v-model.number="height" type="number" min="50" max="250" class="h-9 w-[84px] rounded-ctl border border-line-control bg-surface px-2.5 font-mono text-[14px]" :class="heightOk ? '' : 'border-warning-border'" data-cy="posture-height" />
          cm
        </label>
      </div>
      <p v-if="!heightOk" class="text-[12.5px] text-warning-text">{{ t("The patient's height turns pixels into centimetres.", 'La altura del paciente es lo que pasa los píxeles a centímetros.') }}</p>
      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <input ref="input" type="file" accept="image/*" class="hidden" data-cy="posture-file" @change="onPhoto" />
      <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" data-cy="posture-camera-file" @change="onPhoto" />

      <template v-if="step !== 'result'">
        <div v-if="!current" class="flex flex-col items-center gap-4 rounded-card border border-dashed border-line-control bg-surface p-8 text-center">
          <p class="text-[15px] font-semibold text-ink-900">{{ t(`Photo: ${VIEW_LABELS[step]}`, `Foto: ${VIEW_LABELS[step].toLowerCase()}`) }}</p>
          <ul class="max-w-[520px] list-disc pl-5 text-left text-[13.5px] leading-relaxed text-ink-700">
            <li>{{ t('Standing, relaxed, arms by the sides, feet hip-width apart, barefoot if possible.', 'De pie, relajado, brazos a los lados, pies a la anchura de las caderas, descalzo si puede ser.') }}</li>
            <li>{{ t('Whole body in the picture, head to feet, against a plain wall.', 'Todo el cuerpo en la foto, de la cabeza a los pies, contra una pared lisa.') }}</li>
            <li>{{ t('Camera upright at hip height, 2–3 m away, the same place every time.', 'Cámara vertical a la altura de la cadera, a 2–3 m, siempre en el mismo sitio.') }}</li>
          </ul>
          <p v-if="busy" class="text-[13.5px] font-semibold text-ink-700" data-cy="posture-busy">{{ t('Finding the points…', 'Buscando los puntos…') }}</p>
          <div v-else class="flex flex-wrap justify-center gap-2">
            <UiBtn v-if="touch" variant="primary" data-cy="posture-camera" @click="cameraInput?.click()">{{ t('Take photo', 'Hacer foto') }}</UiBtn>
            <UiBtn :variant="touch ? undefined : 'primary'" data-cy="posture-take" @click="input?.click()">{{ touch ? t('Choose from gallery', 'Elegir de la galería') : t('Choose photo', 'Elegir foto') }}</UiBtn>
          </div>
          <button v-if="(step === 'back' || step === 'left') && canFinish" type="button" class="text-[13px] font-semibold text-ink-muted" data-cy="posture-skip" @click="step = 'result'">{{ t('Skip to the result', 'Saltar al resultado') }}</button>
        </div>
        <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div class="mx-auto w-full max-w-[560px]">
            <PostureOverlay :src="current.url" :width="current.width" :height="current.height" :view="step" :points="current.points" editable @update:points="current.points = $event" />
            <p class="mt-2 text-center text-[12.5px] text-ink-muted" data-cy="posture-found" :data-found="current.found ? 'true' : 'false'">
              {{ current.found ? t('Drag a point to correct it. The blue line is the vertical from the ankle.', 'Arrastra un punto para corregirlo. La línea azul es la vertical desde el tobillo.') : t('No one found automatically: drag each point onto the body.', 'No se ha encontrado a nadie automáticamente: arrastra cada punto a su sitio.') }}
            </p>
          </div>
          <aside class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4" data-cy="posture-live">
            <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted">{{ VIEW_LABELS[step] }} · {{ t('live', 'al momento') }}</p>
            <template v-if="sideLive">
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Ear ahead of the vertical', 'Oreja por delante de la vertical') }}</span><span class="font-mono" data-cy="posture-live-ear">{{ fmt(sideLive.earForward, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Shoulder', 'Hombro') }}</span><span class="font-mono">{{ fmt(sideLive.shoulderForward, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Hip', 'Cadera') }}</span><span class="font-mono">{{ fmt(sideLive.hipForward, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Knee', 'Rodilla') }}</span><span class="font-mono">{{ fmt(sideLive.kneeForward, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Ear–shoulder angle', 'Ángulo oreja–hombro') }}</span><span class="font-mono" data-cy="posture-live-angle">{{ fmt(sideLive.headAngle, '°') }}</span></div>
              <div class="mt-2 rounded-ctl bg-warning-bg p-3">
                <p class="text-[11px] font-[640] uppercase tracking-[.05em] text-warning-text">{{ t('Effective head weight', 'Peso efectivo de la cabeza') }}</p>
                <p class="mt-1 font-mono text-[24px] font-semibold text-ink-900" data-cy="posture-live-weight">{{ fmt(sideLive.headWeight, 'kg') }}</p>
                <p class="text-[12px] text-ink-muted">{{ t('Estimated from the angle · upright ≈ 5 kg', 'Estimado por el ángulo · erguida ≈ 5 kg') }}</p>
              </div>
            </template>
            <template v-else-if="frontLive">
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Head tilt', 'Inclinación de la cabeza') }}</span><span class="font-mono">{{ fmt(frontLive.headTilt, '°') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Shoulders', 'Hombros') }}</span><span class="font-mono" data-cy="posture-live-shoulders">{{ fmt(frontLive.shoulderTilt, '°') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Pelvis', 'Pelvis') }}</span><span class="font-mono">{{ fmt(frontLive.hipTilt, '°') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Head off centre', 'Cabeza desplazada') }}</span><span class="font-mono">{{ fmt(frontLive.headShift, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Shoulders off centre', 'Hombros desplazados') }}</span><span class="font-mono">{{ fmt(frontLive.shoulderShift, 'cm') }}</span></div>
              <div class="flex justify-between border-b border-line-row py-2 text-[13.5px]"><span>{{ t('Pelvis off centre', 'Pelvis desplazada') }}</span><span class="font-mono">{{ fmt(frontLive.hipShift, 'cm') }}</span></div>
              <div class="flex justify-between py-2 text-[13.5px]"><span>{{ t('Knees (R / L)', 'Rodillas (D / I)') }}</span><span class="font-mono" data-cy="posture-live-knees">{{ fmt(frontLive.kneeAngleR, '°') }} / {{ fmt(frontLive.kneeAngleL, '°') }}</span></div>
              <p class="text-[12px] text-ink-muted">{{ t("Tilt: + means the patient's right side is lower. Off centre: + is towards their right. Knees: + is inward.", 'Inclinación: + es el lado derecho del paciente más bajo. Desplazado: + hacia su derecha. Rodillas: + hacia dentro.') }}</p>
            </template>
            <p v-else class="text-[13px] text-ink-muted">{{ t('Enter the height to see measurements.', 'Pon la altura para ver las medidas.') }}</p>
            <div class="mt-auto flex gap-2 pt-3">
              <UiBtn class="flex-1" :disabled="busy" data-cy="posture-retake" @click="(touch ? cameraInput : input)?.click()">{{ t('Retake', 'Repetir foto') }}</UiBtn>
              <UiBtn v-if="touch" class="flex-1" :disabled="busy" data-cy="posture-regallery" @click="input?.click()">{{ t('Gallery', 'Galería') }}</UiBtn>
              <UiBtn class="flex-1" variant="primary" :disabled="next === 'result' && !canFinish" data-cy="posture-next" @click="step = next">{{ next === 'result' ? t('See result', 'Ver resultado') : t(`Next: ${VIEW_LABELS[next].toLowerCase()}`, `Siguiente: ${VIEW_LABELS[next].toLowerCase()}`) }}</UiBtn>
            </div>
            <button v-if="(step === 'back' || step === 'left') && canFinish" type="button" class="text-[12.5px] font-semibold text-ink-muted" data-cy="posture-skip" @click="step = 'result'">{{ t('Skip to the result', 'Saltar al resultado') }}</button>
          </aside>
        </div>
      </template>

      <section v-else class="flex flex-col gap-4" data-cy="posture-result">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div v-for="v in taken" :key="v" class="flex flex-col gap-1">
            <PostureOverlay :src="shots[v]!.url" :width="shots[v]!.width" :height="shots[v]!.height" :view="v" :points="shots[v]!.points" :labels="false" />
            <span class="text-center text-[12.5px] font-semibold text-ink-700">{{ VIEW_LABELS[v] }}</span>
          </div>
        </div>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Notes (optional)', 'Notas (opcional)') }}
          <textarea v-model="notes" rows="2" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal" data-cy="posture-notes" />
        </label>
        <div class="flex gap-2">
          <UiBtn variant="primary" :disabled="saving || !canFinish" data-cy="posture-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save assessment', 'Guardar valoración') }}</UiBtn>
          <span class="self-center text-[12.5px] text-ink-muted">{{ t(`${taken.length} photos`, `${taken.length} fotos`) }}</span>
        </div>
      </section>
    </div>
  </div>
</template>
