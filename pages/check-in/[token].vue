<script setup lang="ts">
import { parsePortalBirthDate } from '~/utils/checkInPortal'

// The check-in portal: a tablet at a location's front desk, left on this page
// all day. A patient types their date of birth (DDMMAA) and is marked as
// arrived -- no app and no login, the way PracticeHub's Check-in Portal works.
// The link is the key (Settings > Clínicas > the location > Portal de
// llegada); the tablet holds no staff session.
//
// After each patient the screen clears itself, so the next one never sees the
// last one's name. Everything here is in Spanish, as the clinic's other
// patient pages with no session are (pages/valorar).
definePageMeta({ layout: false })
useHead({ title: 'Registrar llegada', meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const token = route.params.token as string

type Result =
  | { status: 'not_found' }
  | { status: 'choose'; options: { appointmentId: string; name: string; startsAt: string }[] }
  | { status: 'checked_in' | 'already'; firstName: string; startsAt: string; practitioner: string | null }

const phase = ref<'loading' | 'off' | 'ready'>('loading')
const clinicName = ref('')
const timeZone = ref('Europe/Madrid')
const digits = ref('')
const busy = ref(false)
const error = ref('')
const result = ref<Result | null>(null)

onMounted(async () => {
  try {
    const r = await $fetch<{ clinicName: string; timeZone: string }>(`/api/check-in-portal/${token}`)
    clinicName.value = r.clinicName
    timeZone.value = r.timeZone
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
  digits.value = ''
  error.value = ''
  result.value = null
}
function resetIn(seconds: number) {
  clearTimeout(resetTimer)
  resetTimer = setTimeout(startOver, seconds * 1000)
}

function press(d: string) {
  if (busy.value || result.value || digits.value.length >= 6) return
  error.value = ''
  digits.value += d
  if (digits.value.length === 6) submit()
}
function erase() {
  if (busy.value || result.value) return
  digits.value = digits.value.slice(0, -1)
}
function onKey(e: KeyboardEvent) {
  if (/^\d$/.test(e.key)) press(e.key)
  else if (e.key === 'Backspace') erase()
  else if (e.key === 'Escape') startOver()
}

async function submit(appointmentId?: string) {
  if (!parsePortalBirthDate(digits.value)) {
    error.value = 'Esa fecha no existe. Escríbela como día, mes y año: 070385 para el 7 de marzo de 1985.'
    digits.value = ''
    return
  }
  busy.value = true
  error.value = ''
  try {
    result.value = await $fetch<Result>(`/api/check-in-portal/${token}`, { method: 'POST', body: { birthDate: digits.value, appointmentId } })
    resetIn(result.value.status === 'choose' ? 30 : result.value.status === 'not_found' ? 15 : 10)
  } catch (e: any) {
    if (e?.statusCode === 404) phase.value = 'off'
    else {
      error.value = 'No se ha podido registrar tu llegada. Avisa en recepción.'
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
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timeZone.value })
}
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <div class="flex min-h-screen select-none flex-col items-center justify-center bg-surface-page px-4 py-8 text-ink-900" data-cy="check-in-portal" :data-phase="phase">
    <p v-if="phase === 'loading'" class="text-[15px] text-ink-faint">Cargando…</p>

    <div v-else-if="phase === 'off'" class="max-w-md text-center" data-cy="check-in-portal-off">
      <h1 class="text-[24px] font-semibold">El registro de llegada está desactivado</h1>
      <p class="mt-2 text-[16px] text-ink-muted">Avisa en recepción de que has llegado.</p>
    </div>

    <div v-else class="w-full max-w-[460px]">
      <p class="text-center text-[15px] font-medium text-ink-muted">{{ clinicName }}</p>

      <!-- Hecho -->
      <div v-if="result && (result.status === 'checked_in' || result.status === 'already')" class="mt-6 rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="check-in-portal-done" :data-status="result.status">
        <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-bg text-success-text">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h1 class="mt-5 text-[26px] font-semibold leading-tight">
          {{ result.firstName ? `¡Hola, ${result.firstName}!` : '¡Hola!' }}
        </h1>
        <p class="mt-2 text-[18px] text-ink-700">
          {{ result.status === 'already' ? 'Ya habías registrado tu llegada.' : 'Llegada registrada.' }}
          Toma asiento, te llamamos.
        </p>
        <p class="mt-4 text-[15px] text-ink-muted">
          Tu cita: {{ time(result.startsAt) }}<template v-if="result.practitioner"> con {{ result.practitioner }}</template>
        </p>
        <button type="button" class="mt-7 h-14 w-full rounded-ctl bg-brand text-[18px] font-semibold text-brand-on" data-cy="check-in-portal-finish" @click="startOver">Hecho</button>
      </div>

      <!-- ¿Cuál eres tú? -->
      <div v-else-if="result?.status === 'choose'" class="mt-6" data-cy="check-in-portal-choose">
        <h1 class="text-center text-[24px] font-semibold">¿Cuál eres tú?</h1>
        <p class="mt-1 text-center text-[15px] text-ink-muted">Hay más de una cita con esa fecha de nacimiento.</p>
        <div class="mt-5 flex flex-col gap-3">
          <button
            v-for="o in result.options"
            :key="o.appointmentId"
            type="button"
            class="flex min-h-[64px] items-center justify-between rounded-card border border-line-control bg-surface px-5 text-left shadow-card disabled:opacity-60"
            :disabled="busy"
            data-cy="check-in-portal-option"
            @click="submit(o.appointmentId)"
          >
            <span class="text-[20px] font-semibold tracking-wide">{{ o.name }}</span>
            <span class="text-[16px] text-ink-muted">Cita a las {{ time(o.startsAt) }}</span>
          </button>
        </div>
        <button type="button" class="mt-5 h-12 w-full rounded-ctl border border-line-control bg-surface text-[16px] font-semibold text-ink-700" @click="startOver">Empezar de nuevo</button>
      </div>

      <!-- No encontrada -->
      <div v-else-if="result?.status === 'not_found'" class="mt-6 rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="check-in-portal-not-found">
        <h1 class="text-[24px] font-semibold leading-tight">No encontramos tu cita</h1>
        <p class="mt-2 text-[16px] text-ink-muted">No hay ninguna cita ahora mismo con esa fecha de nacimiento. Comprueba la fecha o avisa en recepción.</p>
        <button type="button" class="mt-7 h-14 w-full rounded-ctl bg-brand text-[18px] font-semibold text-brand-on" data-cy="check-in-portal-retry" @click="startOver">Volver a intentarlo</button>
      </div>

      <!-- Fecha de nacimiento -->
      <div v-else class="mt-4">
        <h1 class="text-center text-[26px] font-semibold leading-tight">¡Bienvenido! Registra tu llegada</h1>
        <p class="mt-1.5 text-center text-[16px] text-ink-muted">Escribe tu fecha de nacimiento</p>

        <div class="mt-6 flex items-end justify-center gap-3" aria-live="polite" data-cy="check-in-portal-date">
          <template v-for="(part, i) in shown" :key="i">
            <div class="flex flex-col items-center gap-1">
              <div class="flex h-16 w-[84px] items-center justify-center rounded-ctl border-[1.5px] bg-surface font-mono text-[30px] font-medium tracking-[.12em]" :class="part.trim().length === 2 ? 'border-brand' : 'border-line-control'">
                {{ part.replace(/ /g, '·') }}
              </div>
              <span class="text-[12.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ ['Día', 'Mes', 'Año'][i] }}</span>
            </div>
            <span v-if="i < 2" class="pb-8 text-[28px] text-ink-faint">/</span>
          </template>
        </div>

        <p v-if="error" role="alert" class="mt-4 text-center text-[15px] font-medium text-danger-text" data-cy="check-in-portal-error">{{ error }}</p>
        <p v-else-if="busy" class="mt-4 text-center text-[15px] text-ink-muted">Buscando tu cita…</p>

        <div class="mx-auto mt-6 grid max-w-[360px] grid-cols-3 gap-3">
          <button v-for="k in KEYS" :key="k" type="button" class="h-[72px] rounded-card border border-line bg-surface text-[28px] font-semibold shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy" :data-cy="`check-in-portal-key-${k}`" @click="press(k)">{{ k }}</button>
          <span />
          <button type="button" class="h-[72px] rounded-card border border-line bg-surface text-[28px] font-semibold shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy" data-cy="check-in-portal-key-0" @click="press('0')">0</button>
          <button type="button" class="flex h-[72px] items-center justify-center rounded-card border border-line bg-surface text-ink-700 shadow-card active:bg-surface-subtle disabled:opacity-60" :disabled="busy || !digits" aria-label="Borrar" data-cy="check-in-portal-erase" @click="erase">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
