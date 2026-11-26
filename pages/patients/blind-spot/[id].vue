<script setup lang="ts">
import {
  BLIND_SPOT_DEFAULT_POINTS,
  BLIND_SPOT_MAX_POINTS,
  BLIND_SPOT_MAX_RADIUS,
  BLIND_SPOT_MIN_POINTS,
  blindSpotArea,
  blindSpotAsymmetry,
  blindSpotPointXY,
  blindSpotRequiredWidthPx,
  blindSpotScreenOffset,
  blindSpotTrials,
  clampBlindSpotPoints,
  formatBlindSpotArea,
  type BlindSpotEye,
  type BlindSpotEyeResult,
  type BlindSpotTrial,
} from '~/utils/blindSpot'

// Blind Spot (punto ciego): the test itself. Set up (screen size, distance,
// how many directions), then each eye in turn at full screen: the patient
// looks at a cross while a dot travels outwards from inside the blind spot,
// and presses the space bar the moment it appears. Saved as one row of
// blind_spot_tests; a "before the adjustment" test offers the "after" next,
// under the same session.

const t = useT()
const route = useRoute()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const { showToast } = useToast()
const patientId = route.params.id as string

const patientName = ref('')
onMounted(async () => {
  const { data: p } = await supabase.from('patients').select('first_name, last_name').eq('id', patientId).maybeSingle()
  patientName.value = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
})

const backTo = computed(() => `/patients/${patientId}?tab=blind-spot`)

// ---- Set-up, remembered on this device: the screen does not change between patients.
const PX_KEY = 'quiroflow-blind-spot-px-per-mm'
const DIST_KEY = 'quiroflow-blind-spot-distance-cm'
const POINTS_KEY = 'quiroflow-blind-spot-points'
const CARD_W_MM = 85.6
const CARD_H_MM = 53.98

const pxPerMm = ref(96 / 25.4)
const distanceCm = ref(50)
const points = ref(BLIND_SPOT_DEFAULT_POINTS)
const pointChoices = [4, 8, 12, 16]
const firstEye = ref<BlindSpotEye>('right')

function readNumber(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
function remember(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    // private mode: the set-up is asked again next time
  }
}
onMounted(() => {
  pxPerMm.value = readNumber(PX_KEY) ?? pxPerMm.value
  distanceCm.value = readNumber(DIST_KEY) ?? distanceCm.value
  points.value = clampBlindSpotPoints(readNumber(POINTS_KEY) ?? points.value)
})

// The "after" half of a before/after pair arrives with the session it belongs to.
const sessionId = ref<string | null>(typeof route.query.session === 'string' ? route.query.session : null)
const phase = ref<'single' | 'pre' | 'post'>(sessionId.value && route.query.phase === 'post' ? 'post' : 'single')

const viewportWidth = ref(1280)
onMounted(() => {
  viewportWidth.value = window.innerWidth
})
const screenTooSmall = computed(() => blindSpotRequiredWidthPx(distanceCm.value, pxPerMm.value) + 48 > viewportWidth.value)

// ---- The test
type Step = 'setup' | 'eye' | 'running' | 'done'
const step = ref<Step>('setup')
const eyeOrder = computed<BlindSpotEye[]>(() => (firstEye.value === 'right' ? ['right', 'left'] : ['left', 'right']))
const eyeIndex = ref(0)
const currentEye = computed(() => eyeOrder.value[eyeIndex.value]!)
const results = reactive<Partial<Record<BlindSpotEye, BlindSpotEyeResult>>>({})

const trials = ref<BlindSpotTrial[]>([])
const trialIndex = ref(0)
const dot = reactive({ visible: false, x: 0, y: 0 })
const fixation = reactive({ x: 0, y: 0 })
const speedDegPerS = 2
const CATCH_SHOW_MS = 1500
const GAP_MS = 700

let raf = 0
let gapTimer: ReturnType<typeof setTimeout> | null = null
let trialStartedAt = 0
let currentR = 0
let collected: BlindSpotEyeResult = { points: [], catch_trials: 0, false_positives: 0 }

const directionCount = computed(() => trials.value.filter((x) => x.kind === 'direction').length)
const directionsDone = computed(() => trials.value.slice(0, trialIndex.value).filter((x) => x.kind === 'direction').length)
const progressPercent = computed(() => (trials.value.length ? (trialIndex.value / trials.value.length) * 100 : 0))

const dotSizePx = computed(() => Math.max(8, Math.tan((0.6 * Math.PI) / 180) * distanceCm.value * 10 * pxPerMm.value))

function placeFixation() {
  const w = window.innerWidth
  const need = blindSpotRequiredWidthPx(distanceCm.value, pxPerMm.value)
  const margin = Math.max(32, (w - need) / 2)
  fixation.x = currentEye.value === 'right' ? margin : w - margin
  fixation.y = window.innerHeight / 2
}

function placeDot(angle: number, r: number) {
  const { dx, dy } = blindSpotScreenOffset(currentEye.value, blindSpotPointXY({ angle, r }), distanceCm.value, pxPerMm.value)
  dot.x = fixation.x + dx
  dot.y = fixation.y + dy
}

function startEye() {
  remember(PX_KEY, pxPerMm.value)
  remember(DIST_KEY, distanceCm.value)
  remember(POINTS_KEY, clampBlindSpotPoints(points.value))
  collected = { points: [], catch_trials: 0, false_positives: 0 }
  trials.value = blindSpotTrials(clampBlindSpotPoints(points.value))
  trialIndex.value = 0
  step.value = 'running'
  void document.documentElement.requestFullscreen?.().catch(() => {})
  placeFixation()
  nextTrial()
}

function nextTrial() {
  cancelAnimationFrame(raf)
  dot.visible = false
  if (trialIndex.value >= trials.value.length) return finishEye()
  gapTimer = setTimeout(runTrial, GAP_MS)
}

function runTrial() {
  const trial = trials.value[trialIndex.value]!
  trialStartedAt = performance.now()
  currentR = 0
  if (trial.kind === 'catch') {
    // Still, at the centre of the blind spot: a patient looking at the cross cannot see it.
    collected.catch_trials++
    placeDot(0, 0)
    dot.visible = true
    gapTimer = setTimeout(() => {
      trialIndex.value++
      nextTrial()
    }, CATCH_SHOW_MS)
    return
  }
  placeDot(trial.angle, 0)
  dot.visible = true
  const tick = (now: number) => {
    currentR = ((now - trialStartedAt) / 1000) * speedDegPerS
    if (currentR > BLIND_SPOT_MAX_RADIUS) {
      collected.points.push({ angle: trial.angle, r: null })
      trialIndex.value++
      nextTrial()
      return
    }
    placeDot(trial.angle, currentR)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function respond() {
  if (step.value !== 'running' || !dot.visible) return
  const trial = trials.value[trialIndex.value]
  if (!trial) return
  if (gapTimer) clearTimeout(gapTimer)
  if (trial.kind === 'catch') {
    collected.false_positives++
  } else {
    collected.points.push({ angle: trial.angle, r: Math.round(currentR * 100) / 100 })
  }
  trialIndex.value++
  nextTrial()
}

function finishEye() {
  results[currentEye.value] = { ...collected, points: collected.points.slice().sort((a, b) => a.angle - b.angle) }
  if (eyeIndex.value === 0) {
    eyeIndex.value = 1
    step.value = 'eye'
    return
  }
  stopFullscreen()
  step.value = 'done'
}

function pause() {
  cancelAnimationFrame(raf)
  if (gapTimer) clearTimeout(gapTimer)
  dot.visible = false
  step.value = 'eye'
}

function backToSetup() {
  stopFullscreen()
  step.value = 'setup'
}

function stopFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
}

function onKey(e: KeyboardEvent) {
  if (step.value === 'running') {
    if (e.code === 'Space') {
      e.preventDefault()
      respond()
    } else if (e.key === 'Escape') {
      pause()
    }
  } else if (step.value === 'eye' && e.code === 'Space') {
    e.preventDefault()
    startEye()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
  if (gapTimer) clearTimeout(gapTimer)
  stopFullscreen()
})

function begin() {
  points.value = clampBlindSpotPoints(points.value)
  eyeIndex.value = 0
  delete results.right
  delete results.left
  step.value = 'eye'
}

// ---- The result
const rightArea = computed(() => (results.right ? blindSpotArea(results.right.points) : null))
const leftArea = computed(() => (results.left ? blindSpotArea(results.left.points) : null))
const asymmetry = computed(() => blindSpotAsymmetry(rightArea.value, leftArea.value))
const falsePositives = computed(() => (results.right?.false_positives ?? 0) + (results.left?.false_positives ?? 0))
const catchTrials = computed(() => (results.right?.catch_trials ?? 0) + (results.left?.catch_trials ?? 0))
const note = ref('')
const saving = ref(false)
const awaitingAfter = ref(false)

const eyeLabel = (eye: BlindSpotEye) => (eye === 'right' ? t('Right eye', 'Ojo derecho') : t('Left eye', 'Ojo izquierdo'))
const coverLabel = (eye: BlindSpotEye) => (eye === 'right' ? t('Cover the left eye', 'Tapa el ojo izquierdo') : t('Cover the right eye', 'Tapa el ojo derecho'))

async function save() {
  if (!store.accountId || !results.right || !results.left || saving.value) return
  saving.value = true
  const session = sessionId.value ?? crypto.randomUUID()
  const { error } = await supabase.from('blind_spot_tests').insert({
    account_id: store.accountId,
    patient_id: patientId,
    session_id: session,
    phase: phase.value,
    right_eye: results.right,
    left_eye: results.left,
    right_area: rightArea.value,
    left_area: leftArea.value,
    points_per_eye: clampBlindSpotPoints(points.value),
    distance_cm: distanceCm.value,
    px_per_mm: Math.round(pxPerMm.value * 1000) / 1000,
    note: note.value.trim() || null,
    created_by: store.teamMember?.id ?? null,
  } as never)
  saving.value = false
  if (error) {
    showToast(t('The test was not saved. Try again.', 'No se ha guardado la prueba. Inténtalo de nuevo.'), 'error')
    return
  }
  if (phase.value === 'pre') {
    sessionId.value = session
    awaitingAfter.value = true
    return
  }
  await navigateTo(backTo.value)
}

function testAfter() {
  if (!sessionId.value) return
  awaitingAfter.value = false
  phase.value = 'post'
  note.value = ''
  void navigateTo({ path: route.path, query: { session: sessionId.value, phase: 'post' } }, { replace: true })
  begin()
}

const allowed = computed(() => store.hasBlindSpot && can('visit_notes_access'))
const cardStyle = computed(() => ({ width: `${CARD_W_MM * pxPerMm.value}px`, height: `${CARD_H_MM * pxPerMm.value}px` }))
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      :title="patientName ? t(`Blind spot · ${patientName}`, `Punto ciego · ${patientName}`) : t('Blind spot', 'Punto ciego')"
      :meta="t('A functional measure for follow-up. Not a diagnostic test.', 'Medición funcional para el seguimiento. No es una prueba diagnóstica.')"
    >
      <NuxtLink
        :to="backTo"
        class="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-ctl border border-transparent px-3.5 text-[13px] font-medium text-ink-muted2 outline-none hover:bg-surface-subtle focus-visible:shadow-focus touch:h-11"
      >
        {{ t('Cancel', 'Cancelar') }}
      </NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <div class="mx-auto flex max-w-[1080px] flex-col gap-4">
        <UiEmptyState
          v-if="!allowed"
          :title="store.hasBlindSpot ? t('You cannot run tests', 'No puedes hacer pruebas') : t('Blind Spot is not on your subscription', 'Blind Spot no está en tu suscripción')"
          :description="store.hasBlindSpot ? t('Running a test needs “See visit notes”. Ask the account owner.', 'Hacer una prueba requiere «Ver notas de visita». Pídeselo al propietario de la cuenta.') : t('Add it under Subscription to measure your patients’ blind spot.', 'Añádelo en Suscripción para medir el punto ciego de tus pacientes.')"
        />

        <!-- 1. Set-up -->
        <template v-else-if="step === 'setup'">
          <div v-if="phase === 'post'" class="rounded-card border border-brand-tintBorder bg-brand-tint px-4 py-3 text-[13px] text-brand-text" data-cy="blind-spot-after">
            {{ t('After the adjustment: this test is saved with the one taken before it.', 'Después del ajuste: esta prueba se guarda junto a la de antes.') }}
          </div>
          <div class="flex flex-wrap gap-4">
            <section class="flex min-w-0 flex-[999_1_480px] flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card" aria-labelledby="bs-size">
              <div>
                <p class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">{{ t('Once on each screen', 'Una vez por pantalla') }}</p>
                <h2 id="bs-size" class="mt-1 text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Screen size', 'Tamaño de la pantalla') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('Hold a bank card against the rectangle and move the slider until the edges match.', 'Apoya una tarjeta bancaria sobre el rectángulo y mueve el control hasta que los bordes coincidan.') }}</p>
              </div>
              <div class="flex min-h-[260px] items-center justify-center overflow-hidden rounded-card border border-dashed border-line-controlHover bg-surface-subtle p-4">
                <div class="relative max-w-full rounded-[14px] border-2 border-brand bg-brand-tint" :style="cardStyle" data-cy="blind-spot-card" />
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between gap-2 text-[13px]">
                  <label for="bs-px" class="font-semibold text-ink-900">{{ t('Rectangle size', 'Tamaño del rectángulo') }}</label>
                  <span class="font-mono text-ink-muted">{{ pxPerMm.toFixed(2) }} px/mm</span>
                </div>
                <input id="bs-px" v-model.number="pxPerMm" type="range" min="2" max="9" step="0.01" class="w-full accent-brand" data-cy="blind-spot-px" />
              </div>
            </section>

            <section class="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card" aria-labelledby="bs-test">
              <h2 id="bs-test" class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('The test', 'La prueba') }}</h2>
              <div class="flex flex-col gap-1.5">
                <label for="bs-distance" class="text-[13px] font-semibold text-ink-900">{{ t('Distance from the screen', 'Distancia a la pantalla') }}</label>
                <div class="flex items-center gap-2">
                  <input id="bs-distance" v-model.number="distanceCm" type="number" min="25" max="100" step="1" class="h-9 w-24 rounded-ctl border border-line-control bg-surface px-3 font-mono text-[13px] touch:h-11" data-cy="blind-spot-distance" />
                  <span class="text-[13px] text-ink-muted">cm</span>
                </div>
                <p class="text-[12.5px] text-ink-muted">{{ t('A chin rest, or a tape measure from the eye to the screen.', 'Con reposabarbillas, o con una cinta del ojo a la pantalla.') }}</p>
                <p v-if="screenTooSmall" class="text-[12.5px] text-warning-text" data-cy="blind-spot-too-small">
                  {{ t('This screen is too narrow at this distance. Sit closer, or use a bigger screen.', 'La pantalla se queda corta a esta distancia. Acércate, o usa una pantalla más grande.') }}
                </p>
              </div>

              <fieldset class="flex flex-col gap-1.5">
                <legend class="text-[13px] font-semibold text-ink-900">{{ t('Points per eye', 'Puntos por ojo') }}</legend>
                <div class="flex flex-wrap gap-1.5">
                  <label
                    v-for="n in pointChoices"
                    :key="n"
                    class="flex h-11 cursor-pointer items-center gap-1.5 rounded-ctl border px-3 font-mono text-[13px]"
                    :class="points === n ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line-control text-ink-500'"
                  >
                    <input v-model.number="points" type="radio" name="bs-points" :value="n" class="accent-brand" />
                    {{ n }}
                  </label>
                  <label class="flex h-11 items-center gap-1.5 rounded-ctl border border-line-control pl-3 pr-1.5 text-[13px] text-ink-500">
                    {{ t('Other', 'Otro') }}
                    <input v-model.number="points" type="number" :min="BLIND_SPOT_MIN_POINTS" :max="BLIND_SPOT_MAX_POINTS" class="h-8 w-16 rounded-ctlSm border border-line-control px-2 font-mono" :aria-label="t('Number of points', 'Número de puntos')" data-cy="blind-spot-points" />
                  </label>
                </div>
                <p class="text-[12.5px] text-ink-muted">{{ t('At least 4. Fewer points, a quicker test; more, a finer outline.', 'Mínimo 4. Menos puntos, prueba más rápida; más puntos, contorno más fino.') }}</p>
              </fieldset>

              <fieldset class="flex flex-col gap-1.5">
                <legend class="text-[13px] font-semibold text-ink-900">{{ t('Start with', 'Empezar por') }}</legend>
                <div class="flex flex-wrap gap-1.5">
                  <label v-for="eye in (['right', 'left'] as const)" :key="eye" class="flex h-11 flex-1 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-[13px]" :class="firstEye === eye ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line-control text-ink-500'">
                    <input v-model="firstEye" type="radio" name="bs-eye" :value="eye" class="accent-brand" />
                    {{ eyeLabel(eye) }}
                  </label>
                </div>
              </fieldset>

              <fieldset v-if="phase !== 'post'" class="flex flex-col gap-1.5">
                <legend class="text-[13px] font-semibold text-ink-900">{{ t('When', 'Cuándo') }}</legend>
                <div class="flex flex-wrap gap-1.5">
                  <label class="flex h-11 flex-1 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-[13px]" :class="phase === 'single' ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line-control text-ink-500'">
                    <input v-model="phase" type="radio" name="bs-phase" value="single" class="accent-brand" />
                    {{ t('Single test', 'Prueba suelta') }}
                  </label>
                  <label class="flex h-11 flex-1 cursor-pointer items-center gap-2 rounded-ctl border px-3 text-[13px]" :class="phase === 'pre' ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line-control text-ink-500'">
                    <input v-model="phase" type="radio" name="bs-phase" value="pre" class="accent-brand" data-cy="blind-spot-phase-pre" />
                    {{ t('Before the adjustment', 'Antes del ajuste') }}
                  </label>
                </div>
              </fieldset>

              <UiBtn variant="primary" size="lg" class="mt-auto w-full" data-cy="blind-spot-begin" @click="begin">{{ t('Start the test', 'Empezar la prueba') }}</UiBtn>
            </section>
          </div>
        </template>

        <!-- 4. Result -->
        <template v-else-if="step === 'done'">
          <section class="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card" aria-labelledby="bs-result" data-cy="blind-spot-result">
            <h2 id="bs-result" class="text-[16px] font-semibold tracking-tightTitle text-ink-900">
              {{ phase === 'pre' ? t('Before the adjustment', 'Antes del ajuste') : phase === 'post' ? t('After the adjustment', 'Después del ajuste') : t('Result', 'Resultado') }}
            </h2>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              <div class="rounded-card border border-line bg-surface-subtle p-3.5">
                <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Left eye', 'Ojo izquierdo') }}</p>
                <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-cy="blind-spot-left-area">{{ formatBlindSpotArea(leftArea) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">°²</span></p>
              </div>
              <div class="rounded-card border border-line bg-surface-subtle p-3.5">
                <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Right eye', 'Ojo derecho') }}</p>
                <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-cy="blind-spot-right-area">{{ formatBlindSpotArea(rightArea) }}<span class="ml-1 text-[12.5px] font-normal text-ink-muted">°²</span></p>
              </div>
              <div class="rounded-card border border-line bg-surface-subtle p-3.5">
                <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Difference between eyes', 'Diferencia entre ojos') }}</p>
                <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ asymmetry ? `${asymmetry.percent} %` : '—' }}</p>
              </div>
              <div class="rounded-card border border-line bg-surface-subtle p-3.5">
                <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Reliability', 'Fiabilidad') }}</p>
                <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ catchTrials - falsePositives }}/{{ catchTrials }}</p>
                <p class="text-[12px] text-ink-muted">{{ t('checks with no false positive', 'controles sin falso positivo') }}</p>
              </div>
            </div>
            <p v-if="falsePositives > 0" class="text-[12.5px] text-warning-text">
              {{ t('The patient answered to a dot they should not have seen. Their eye may have moved off the cross: consider repeating the test.', 'El paciente respondió a un punto que no debía ver. Puede que haya movido la mirada de la cruz: valora repetir la prueba.') }}
            </p>
            <div v-if="!awaitingAfter" class="flex flex-col gap-1.5">
              <label for="bs-note" class="text-[13px] font-semibold text-ink-900">{{ t('Note', 'Nota') }}</label>
              <textarea id="bs-note" v-model="note" rows="3" maxlength="2000" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px]" />
            </div>
            <div v-if="awaitingAfter" class="flex flex-wrap items-center gap-2 rounded-card border border-brand-tintBorder bg-brand-tint p-3.5">
              <p class="flex-1 text-[13px] text-brand-text">{{ t('Saved. Adjust the patient, then measure again.', 'Guardada. Ajusta al paciente y vuelve a medir.') }}</p>
              <NuxtLink :to="backTo" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 touch:h-11">{{ t('Later', 'Más tarde') }}</NuxtLink>
              <UiBtn variant="primary" data-cy="blind-spot-test-after" @click="testAfter">{{ t('Measure after the adjustment', 'Medir después del ajuste') }}</UiBtn>
            </div>
            <div v-else class="flex flex-wrap justify-end gap-2">
              <UiBtn @click="begin">{{ t('Repeat', 'Repetir') }}</UiBtn>
              <UiBtn variant="primary" :disabled="saving" data-cy="blind-spot-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save test', 'Guardar prueba') }}</UiBtn>
            </div>
          </section>
        </template>
      </div>
    </div>

    <!-- 2 and 3. Each eye, at full screen. Fixed colours, not the theme's: in
    dark mode the theme's ink is near white, and the dot vanished on this grey. -->
    <div
      v-if="allowed && (step === 'eye' || step === 'running')"
      class="fixed inset-0 z-[60] select-none bg-[#EDEEF1] text-[#22252F]"
      data-cy="blind-spot-screen"
      @pointerdown="step === 'running' ? respond() : undefined"
    >
      <div class="absolute left-6 right-6 top-5 flex flex-wrap items-center gap-3 text-[13px] text-[#686D7D]">
        <span class="font-semibold text-[#3A3F52]">{{ eyeLabel(currentEye) }}</span>
        <span>· {{ coverLabel(currentEye) }}</span>
        <template v-if="step === 'running'">
          <div class="h-1 w-48 overflow-hidden rounded-full bg-[#DCDEE4]" role="progressbar" :aria-valuenow="Math.round(progressPercent)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('Progress', 'Progreso')">
            <div class="h-full bg-brand" :style="{ width: `${progressPercent}%` }" />
          </div>
          <span class="font-mono text-[12px]" data-cy="blind-spot-progress">{{ t(`${directionsDone} / ${directionCount} points`, `${directionsDone} / ${directionCount} puntos`) }}</span>
        </template>
        <span class="flex-1" />
        <button v-if="step === 'running'" type="button" class="h-9 rounded-ctl border border-[#DCDEE4] px-3.5 text-[#3A3F52]" @pointerdown.stop @click="pause">{{ t('Pause · Esc', 'Pausa · Esc') }}</button>
        <button v-else type="button" class="h-9 rounded-ctl border border-[#DCDEE4] px-3.5 text-[#3A3F52]" @click="backToSetup">{{ t('Back', 'Volver') }}</button>
      </div>

      <template v-if="step === 'running'">
        <div class="pointer-events-none absolute h-6 w-6" :style="{ left: `${fixation.x - 12}px`, top: `${fixation.y - 12}px` }" aria-hidden="true">
          <div class="absolute left-[11px] top-0 h-6 w-0.5 bg-[#15171E]" />
          <div class="absolute left-0 top-[11px] h-0.5 w-6 bg-[#15171E]" />
        </div>
        <div
          v-show="dot.visible"
          class="pointer-events-none absolute rounded-full bg-[#15171E]"
          :style="{ width: `${dotSizePx}px`, height: `${dotSizePx}px`, left: `${dot.x - dotSizePx / 2}px`, top: `${dot.y - dotSizePx / 2}px` }"
          aria-hidden="true"
          data-cy="blind-spot-dot"
        />
        <p class="pointer-events-none absolute inset-x-0 bottom-24 mx-auto max-w-[560px] px-6 text-center text-[19px] font-medium leading-snug text-[#22252F]">
          {{ t('Keep looking at the cross. Press the space bar (or tap) as soon as you see the dot.', 'Sin mover los ojos de la cruz, pulsa la barra espaciadora (o toca) en cuanto veas el punto.') }}
        </p>
      </template>

      <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
        <p class="text-[13px] font-semibold uppercase tracking-[.07em] text-[#686D7D]">{{ t(`Eye ${eyeIndex + 1} of 2`, `Ojo ${eyeIndex + 1} de 2`) }}</p>
        <h2 class="text-[30px] font-semibold tracking-tightTitle text-[#15171E]">{{ coverLabel(currentEye) }}</h2>
        <p class="max-w-[520px] text-[16px] text-[#3A3F52]">
          {{ t(`Sit ${distanceCm} cm from the screen and look at the cross the whole time. A dot will move out from beside it; press the space bar the moment you see it.`, `Siéntate a ${distanceCm} cm de la pantalla y mira la cruz todo el rato. Saldrá un punto desde un lado; pulsa la barra espaciadora en cuanto lo veas.`) }}
        </p>
        <UiBtn variant="primary" size="lg" data-cy="blind-spot-start-eye" @click="startEye">{{ t('Start · Space', 'Empezar · Espacio') }}</UiBtn>
      </div>
    </div>
  </div>
</template>
