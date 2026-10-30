<script setup lang="ts">
import { parsePortalBirthDate } from '~/utils/checkInPortal'
import { PORTAL_LANGUAGES, PORTAL_LANGUAGE_NAMES, PORTAL_LOCALES, PORTAL_TEXT, isPortalLanguage, type PortalLanguage } from '~/utils/checkInPortalText'

// The check-in portal: a tablet at a location's front desk, left on this page
// all day. A patient types their date of birth (DDMMAA) or shows the QR code
// from their app, and is marked as arrived -- no login, the way PracticeHub's
// Check-in Portal works. The link is the key (Settings > Clínicas > the
// location > Portal de llegada); the tablet holds no staff session.
//
// The QR code is read two ways: a USB or Bluetooth scanner, which types the
// code and Enter as a keyboard would, or the tablet's own camera.
//
// It speaks the language chosen in Settings, with the clinic's own messages
// in it; a patient can switch language, and gets the standard wording in
// theirs. After each patient the screen clears itself and goes back to the
// tablet's language, so the next one never sees the last one's name.
definePageMeta({ layout: false })
useHead({ title: 'Check-in', meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const token = route.params.token as string

type Result =
  | { status: 'not_found' }
  | { status: 'choose'; options: { appointmentId: string; name: string; startsAt: string }[] }
  | { status: 'checked_in' | 'already'; firstName: string; startsAt: string; practitioner: string | null }
interface Messages { welcome: string | null; success: string | null; notFound: string | null }

const phase = ref<'loading' | 'off' | 'ready'>('loading')
const clinicName = ref('')
const timeZone = ref('Europe/Madrid')
const portalLanguage = ref<PortalLanguage>('es')
const messages = ref<Messages>({ welcome: null, success: null, notFound: null })
const lang = ref<PortalLanguage>('es')
const tx = computed(() => PORTAL_TEXT[lang.value])
// The clinic's own wording is written in the tablet's language, so it only
// replaces the standard text while the tablet is in that language.
function custom(kind: keyof Messages): string | null {
  return lang.value === portalLanguage.value ? messages.value[kind] : null
}

const digits = ref('')
const busy = ref(false)
const error = ref('')
const result = ref<Result | null>(null)
const camera = ref<'off' | 'starting' | 'on'>('off')
const video = ref<HTMLVideoElement | null>(null)

onMounted(async () => {
  try {
    const r = await $fetch<{ clinicName: string; timeZone: string; language: string; messages: Messages }>(`/api/check-in-portal/${token}`)
    clinicName.value = r.clinicName
    timeZone.value = r.timeZone
    portalLanguage.value = isPortalLanguage(r.language) ? r.language : 'es'
    lang.value = portalLanguage.value
    messages.value = r.messages
    phase.value = 'ready'
  } catch {
    phase.value = 'off'
  }
  keepAwake()
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', keepAwake)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', keepAwake)
  clearTimeout(resetTimer)
  stopCamera()
})

// A tablet that dims and locks between patients is a portal nobody uses. The
// wake lock is released whenever the page is hidden, so it is asked for again
// each time it comes back.
async function keepAwake() {
  if (document.visibilityState !== 'visible') return
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen')
  } catch {
    // Not supported, or refused: the tablet's own settings have to do it.
  }
}

// Back to the start: after a result, by itself, so the next patient never
// sees the last one's name; and a "which one is you?" left unanswered.
let resetTimer: ReturnType<typeof setTimeout> | undefined
function startOver() {
  clearTimeout(resetTimer)
  stopCamera()
  digits.value = ''
  error.value = ''
  result.value = null
  lang.value = portalLanguage.value
}
function resetIn(seconds: number) {
  clearTimeout(resetTimer)
  resetTimer = setTimeout(startOver, seconds * 1000)
}
function pickLanguage(next: PortalLanguage) {
  lang.value = next
  // Somebody picking a language and walking off should not leave it set.
  if (!result.value) resetIn(60)
}

function press(d: string) {
  if (busy.value || result.value || digits.value.length >= 6) return
  error.value = ''
  digits.value += d
  if (digits.value.length === 6) submitBirthDate()
}
function erase() {
  if (busy.value || result.value) return
  digits.value = digits.value.slice(0, -1)
}

// A scanner types its code and Enter faster than anyone could. A code always
// starts with a letter (qfci.), so a letter starts collecting one, and digits
// after it belong to the code, not the date.
let scanned = ''
let scanTimer: ReturnType<typeof setTimeout> | undefined
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (scanned) submitCode(scanned)
    scanned = ''
    return
  }
  if (e.key.length === 1 && (scanned || !/\d/.test(e.key))) {
    scanned += e.key
    clearTimeout(scanTimer)
    scanTimer = setTimeout(() => (scanned = ''), 1000)
    return
  }
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') erase()
  else if (e.key === 'Escape') startOver()
}

// The tablet's own camera, for a clinic with no scanner. jsQR rather than the
// browser's BarcodeDetector, which Safari on an iPad does not have; loaded
// only when someone taps the button.
let stream: MediaStream | null = null
let frame = 0
async function startCamera() {
  if (camera.value !== 'off' || busy.value) return
  error.value = ''
  camera.value = 'starting'
  try {
    const [{ default: jsQR }, media] = await Promise.all([import('jsqr'), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })])
    stream = media
    camera.value = 'on'
    await nextTick()
    if (!video.value) return stopCamera()
    video.value.srcObject = media
    await video.value.play()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const tick = () => {
      const v = video.value
      if (!stream || !v) return
      if (v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        ctx.drawImage(v, 0, 0)
        const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })
        if (found?.data) {
          stopCamera()
          submitCode(found.data)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    resetIn(60)
  } catch {
    stopCamera()
    error.value = tx.value.cameraUnavailable
  }
}
function stopCamera() {
  cancelAnimationFrame(frame)
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  camera.value = 'off'
}

function submitBirthDate(appointmentId?: string) {
  if (!parsePortalBirthDate(digits.value)) {
    error.value = tx.value.badDate
    digits.value = ''
    return
  }
  return submit({ birthDate: digits.value, appointmentId })
}
function submitCode(code: string) {
  if (busy.value) return
  digits.value = ''
  return submit({ code: code.trim() })
}
async function submit(body: { birthDate?: string; appointmentId?: string; code?: string }) {
  busy.value = true
  error.value = ''
  try {
    result.value = await $fetch<Result>(`/api/check-in-portal/${token}`, { method: 'POST', body })
    resetIn(result.value.status === 'choose' ? 30 : result.value.status === 'not_found' ? 15 : 10)
  } catch (e: any) {
    if (e?.statusCode === 404) phase.value = 'off'
    else {
      error.value = tx.value.failed
      digits.value = ''
    }
  } finally {
    busy.value = false
  }
}

const shown = computed(() => {
  const d = digits.value.padEnd(6, ' ')
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)]
})
function time(iso: string) {
  return new Date(iso).toLocaleTimeString(PORTAL_LOCALES[lang.value], { hour: '2-digit', minute: '2-digit', timeZone: timeZone.value })
}
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <div class="flex min-h-screen select-none flex-col items-center justify-center bg-surface-page px-4 py-8 text-ink-900" data-cy="check-in-portal" :data-phase="phase" :lang="lang">
    <p v-if="phase === 'loading'" class="text-[15px] text-ink-faint">{{ tx.loading }}</p>

    <div v-else-if="phase === 'off'" class="max-w-md text-center" data-cy="check-in-portal-off">
      <h1 class="text-[24px] font-semibold">{{ tx.offTitle }}</h1>
      <p class="mt-2 text-[16px] text-ink-muted">{{ tx.offText }}</p>
    </div>

    <div v-else class="w-full max-w-[460px]">
      <p class="text-center text-[15px] font-medium text-ink-muted">{{ clinicName }}</p>

      <!-- Hecho -->
      <div v-if="result && (result.status === 'checked_in' || result.status === 'already')" class="mt-6 rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="check-in-portal-done" :data-status="result.status">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-text">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h1 class="mt-5 text-[26px] font-semibold leading-tight">{{ tx.hello(result.firstName) }}</h1>
        <p class="mt-2 whitespace-pre-line text-[18px] text-ink-700" data-cy="check-in-portal-done-text">
          {{ result.status === 'already' ? tx.alreadyArrived : custom('success') || tx.arrived }}
        </p>
        <p class="mt-4 text-[15px] text-ink-muted">{{ tx.yourVisit(time(result.startsAt), result.practitioner) }}</p>
        <button type="button" class="mt-7 h-14 w-full rounded-ctl bg-brand text-[18px] font-semibold text-brand-on" data-cy="check-in-portal-finish" @click="startOver">{{ tx.done }}</button>
      </div>

      <!-- ¿Cuál eres tú? -->
      <div v-else-if="result?.status === 'choose'" class="mt-6" data-cy="check-in-portal-choose">
        <h1 class="text-center text-[24px] font-semibold">{{ tx.chooseTitle }}</h1>
        <p class="mt-1 text-center text-[15px] text-ink-muted">{{ tx.chooseText }}</p>
        <div class="mt-5 flex flex-col gap-3">
          <button
            v-for="o in result.options"
            :key="o.appointmentId"
            type="button"
            class="flex min-h-[64px] items-center justify-between rounded-card border border-line-control bg-surface px-5 text-left shadow-card disabled:opacity-60"
            :disabled="busy"
            data-cy="check-in-portal-option"
            @click="submitBirthDate(o.appointmentId)"
          >
            <span class="text-[20px] font-semibold tracking-wide">{{ o.name }}</span>
            <span class="text-[16px] text-ink-muted">{{ tx.visitAt(time(o.startsAt)) }}</span>
          </button>
        </div>
        <button type="button" class="mt-5 h-12 w-full rounded-ctl border border-line-control bg-surface text-[16px] font-semibold text-ink-700" @click="startOver">{{ tx.startOver }}</button>
      </div>

      <!-- No encontrada -->
      <div v-else-if="result?.status === 'not_found'" class="mt-6 rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="check-in-portal-not-found">
        <h1 class="text-[24px] font-semibold leading-tight">{{ tx.notFoundTitle }}</h1>
        <p class="mt-2 whitespace-pre-line text-[16px] text-ink-muted" data-cy="check-in-portal-not-found-text">{{ custom('notFound') || tx.notFoundText }}</p>
        <button type="button" class="mt-7 h-14 w-full rounded-ctl bg-brand text-[18px] font-semibold text-brand-on" data-cy="check-in-portal-retry" @click="startOver">{{ tx.tryAgain }}</button>
      </div>

      <!-- Cámara -->
      <div v-else-if="camera !== 'off'" class="mt-6 flex flex-col items-center" data-cy="check-in-portal-camera">
        <p class="text-center text-[18px] text-ink-700">{{ tx.scanHint }}</p>
        <video ref="video" class="mt-5 aspect-square w-full max-w-[360px] -scale-x-100 rounded-card bg-ink-900 object-cover" muted playsinline />
        <p v-if="busy" class="mt-4 text-center text-[15px] text-ink-muted">{{ tx.searching }}</p>
        <button type="button" class="mt-5 h-12 w-full max-w-[360px] rounded-ctl border border-line-control bg-surface text-[16px] font-semibold text-ink-700" @click="startOver">{{ tx.cancel }}</button>
      </div>

      <!-- Fecha de nacimiento -->
      <div v-else class="mt-4">
        <h1 class="whitespace-pre-line text-center text-[26px] font-semibold leading-tight" data-cy="check-in-portal-welcome">{{ custom('welcome') || tx.welcomeTitle }}</h1>
        <p class="mt-1.5 text-center text-[16px] text-ink-muted">{{ tx.typeBirthDate }}</p>

        <div class="mt-6 flex items-end justify-center gap-3" aria-live="polite" data-cy="check-in-portal-date">
          <template v-for="(part, i) in shown" :key="i">
            <div class="flex flex-col items-center gap-1">
              <div class="flex h-16 w-[84px] items-center justify-center rounded-ctl border-[1.5px] bg-surface font-mono text-[30px] font-medium tracking-[.12em]" :class="part.trim().length === 2 ? 'border-brand' : 'border-line-control'">
                {{ part.replace(/ /g, '·') }}
              </div>
              <span class="text-[12.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ [tx.day, tx.month, tx.year][i] }}</span>
            </div>
            <span v-if="i < 2" class="pb-8 text-[28px] text-ink-faint">/</span>
          </template>
        </div>

        <p v-if="error" role="alert" class="mt-4 text-center text-[15px] font-medium text-danger-text" data-cy="check-in-portal-error">{{ error }}</p>
        <p v-else-if="busy" class="mt-4 text-center text-[15px] text-ink-muted">{{ tx.searching }}</p>

        <div class="mx-auto mt-6 grid max-w-[360px] grid-cols-3 gap-3">
          <button v-for="k in KEYS" :key="k" type="button" class="h-[72px] rounded-card border border-line bg-surface text-[28px] font-semibold shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy" :data-cy="`check-in-portal-key-${k}`" @click="press(k)">{{ k }}</button>
          <span />
          <button type="button" class="h-[72px] rounded-card border border-line bg-surface text-[28px] font-semibold shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy" data-cy="check-in-portal-key-0" @click="press('0')">0</button>
          <button type="button" class="flex h-[72px] items-center justify-center rounded-card border border-line bg-surface text-ink-700 shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy || !digits" :aria-label="tx.erase" data-cy="check-in-portal-erase" @click="erase">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6" /></svg>
          </button>
        </div>

        <div class="mx-auto mt-6 flex max-w-[360px] flex-col items-center gap-2">
          <span class="text-[14px] text-ink-muted">{{ tx.orScan }}</span>
          <button type="button" class="flex h-12 w-full items-center justify-center gap-2 rounded-ctl border border-line-control bg-surface text-[16px] font-semibold text-ink-700 disabled:opacity-60" :disabled="busy" data-cy="check-in-portal-scan" @click="startCamera">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" /></svg>
            {{ tx.scan }}
          </button>
        </div>
      </div>

      <!-- Idioma: only before anyone is identified, and back to the tablet's own after them. -->
      <div v-if="!result && camera === 'off'" class="mt-8 flex flex-wrap justify-center gap-1.5" role="group" :aria-label="tx.language" data-cy="check-in-portal-languages">
        <button
          v-for="l in PORTAL_LANGUAGES"
          :key="l"
          type="button"
          :lang="l"
          :aria-pressed="lang === l"
          :aria-label="PORTAL_LANGUAGE_NAMES[l]"
          class="h-10 min-w-[48px] rounded-pill px-3 text-[13px] font-semibold uppercase tracking-[.04em]"
          :class="lang === l ? 'bg-brand text-brand-on' : 'border border-line-control bg-surface text-ink-500'"
          :data-cy="`check-in-portal-lang-${l}`"
          @click="pickLanguage(l)"
        >
          {{ l }}
        </button>
      </div>
    </div>
  </div>
</template>
