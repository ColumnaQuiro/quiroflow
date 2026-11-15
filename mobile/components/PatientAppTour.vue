<script setup lang="ts">
// The guided tour over the patient's Inicio (composables/usePatientAppTour.ts
// says when it runs). The screen darkens, one thing at a time stays lit, and a
// card under or over it says what it is: the next visit, Plan (their visits),
// the sessions and credit tiles (payments and invoices), Documentos and
// Cuidarme (their exercises). Messages is left out on purpose: it explains
// itself.
//
// Each step points at an element marked data-tour="<key>" -- on Inicio, or a
// tab in the bar (the side menu on an iPad, which carries the same marks
// through useAppNav.ts). A step whose mark is not on screen is dropped rather
// than pointed at nothing: Documentos and Cuidarme are not there for a family
// member managed for visits and payments only.
//
// The tour stays on Inicio and does not navigate: taps outside the card do
// nothing, so the patient is not carried off to another tab mid-tour.
const t = useT()
const route = useRoute()
const tour = usePatientAppTour()
const homeReady = usePatientHomeReady()
// The Face ID offer (AppFaceIdOffer.vue) and this never share the screen:
// whichever opens first goes first, and the other waits for it to close.
const faceIdOfferOpen = useState('faceid-offer-open', () => false)
const lock = useAppLock()
const family = useFamily()
const { settings } = usePatientAppInfo()

interface Step {
  key: string
  title: string
  body: string
}

const STEPS = computed<Step[]>(() => {
  const s = settings.value
  const change = s.rescheduleEnabled && s.cancelEnabled
    ? t(' You can also change or cancel them from there.', ' Desde ahí también puedes cambiarlas o cancelarlas.')
    : s.rescheduleEnabled
      ? t(' You can also change them from there.', ' Desde ahí también puedes cambiarlas.')
      : s.cancelEnabled
        ? t(' You can also cancel them from there.', ' Desde ahí también puedes cancelarlas.')
        : ''
  return [
    {
      key: 'next-visit',
      title: t('Your next visit', 'Tu próxima cita'),
      body:
        t('Your next visit is always here: the day, the time and who you will see.', 'Aquí tienes siempre tu próxima visita: el día, la hora y con quién.')
        + (s.bookingEnabled ? t(' When you have nothing booked, you can book from here.', ' Cuando no tengas ninguna, puedes reservarla desde aquí.') : ''),
    },
    {
      key: 'visits',
      title: t('Your visits', 'Tus citas'),
      body: t('Plan has all your visits: the ones coming up, the ones you have had, and your care plan.', 'En Plan están todas tus citas: las próximas, las que ya has tenido y tu plan de tratamiento.') + change,
    },
    {
      key: 'money',
      title: t('Payments and invoices', 'Pagos y facturas'),
      body: t(
        'Here are the sessions left on your package and any credit in your favour. Your invoices, and anything waiting to be paid, are in Plan.',
        'Aquí ves las sesiones que te quedan del bono y tu saldo a favor. Tus facturas, y lo que tengas pendiente de pago, están en Plan.',
      ),
    },
    {
      key: 'documents',
      title: t('Your documents', 'Tus documentos'),
      body: t('Reports, consent forms and any files your clinic shares with you, always to hand.', 'Los informes, consentimientos y archivos que te comparta tu clínica, siempre a mano.'),
    },
    {
      key: 'care',
      title: t('Your wellbeing', 'Tu bienestar'),
      body: t(
        'Self-care has the exercises your clinic gives you to do at home. Tick them off each day, and add habits of your own with reminders.',
        'En Cuidarme están los ejercicios que te pauta tu clínica para hacer en casa. Márcalos cada día y crea tus propios hábitos con recordatorios.',
      ),
    },
  ]
})

// The visible element for a step: the tab bar on a phone, the side menu on an
// iPad, each drawn or hidden by CSS, so the first one with a size wins.
function target(key: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`))
  return all.find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }) ?? null
}

const keys = ref<string[]>([])
const index = ref(0)
const steps = computed(() => keys.value.map((k) => STEPS.value.find((s) => s.key === k)!).filter(Boolean))
const step = computed(() => (tour.open.value ? steps.value[index.value] ?? null : null))
const last = computed(() => index.value === steps.value.length - 1)

let startTimer: ReturnType<typeof setTimeout> | undefined
function maybeStart() {
  if (tour.open.value) return
  if (route.path !== '/' || !homeReady.value || faceIdOfferOpen.value || lock.locked.value) return
  // Not on its own while looking at a family member's account: the first
  // time should be on their own.
  if (!tour.requested.value && (tour.seen() || family.actingForOther.value)) return
  const available = STEPS.value.map((s) => s.key).filter((k) => target(k))
  if (!available.length) {
    finish()
    return
  }
  keys.value = available
  index.value = 0
  tour.open.value = true
}
// A moment after Inicio settles, so it is not the first thing that moves.
watch(
  () => [route.path, homeReady.value, faceIdOfferOpen.value, lock.locked.value, tour.requested.value, family.actingForOther.value],
  () => {
    clearTimeout(startTimer)
    startTimer = setTimeout(maybeStart, 700)
  },
  { immediate: true },
)

function finish() {
  tour.markSeen()
  tour.requested.value = false
  tour.open.value = false
}
function next() {
  if (last.value) finish()
  else index.value++
}
function back() {
  if (index.value > 0) index.value--
}
// Leaving Inicio (a notification tapped mid-tour) ends it; it counts as seen.
watch(() => route.path, (p) => { if (p !== '/' && tour.open.value) finish() })

// Where the lit element is, followed every frame while the tour is open:
// Inicio's figures can still shift, and scrolling a card into view moves it.
interface Box { top: number; left: number; width: number; height: number }
const rect = ref<Box | null>(null)
const viewport = ref({ width: 0, height: 0 })
let raf = 0
function track() {
  const el = step.value ? target(step.value.key) : null
  if (el) {
    const r = el.getBoundingClientRect()
    const prev = rect.value
    if (!prev || prev.top !== r.top || prev.left !== r.left || prev.width !== r.width || prev.height !== r.height) {
      rect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
    }
  } else if (rect.value) {
    rect.value = null
  }
  if (viewport.value.width !== window.innerWidth || viewport.value.height !== window.innerHeight) {
    viewport.value = { width: window.innerWidth, height: window.innerHeight }
  }
  raf = requestAnimationFrame(track)
}
watch(() => tour.open.value, (on) => {
  cancelAnimationFrame(raf)
  if (on) raf = requestAnimationFrame(track)
  else rect.value = null
}, { immediate: true })
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(startTimer)
  // Torn down with the layout (signing out): the next start should not think
  // it is still on screen.
  tour.open.value = false
})

// A step below the fold (Documentos on a short phone) is scrolled to the
// middle first; one already in view is left where it is.
const primary = ref<{ $el?: HTMLElement } | null>(null)
watch(step, async (s) => {
  if (!s) return
  const el = target(s.key)
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.top < 72 || r.bottom > window.innerHeight - 140) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  await nextTick()
  primary.value?.$el?.focus?.()
})

const PAD = 8
const GAP = 14
const hole = computed(() => {
  const r = rect.value
  if (!r) return null
  return {
    top: `${r.top - PAD}px`,
    left: `${r.left - PAD}px`,
    width: `${r.width + PAD * 2}px`,
    height: `${r.height + PAD * 2}px`,
  }
})
// The card goes under the lit element when there is room, otherwise over it;
// beside it for a narrow item on the iPad's side menu. Full width on a phone.
// With nothing to light (the element went away mid-tour) it sits at the
// bottom, so there is always a way on or out.
const card = computed(() => {
  const r = rect.value
  const vw = viewport.value.width
  const vh = viewport.value.height
  if (!vw) return null
  const wide = vw >= 768
  const width = wide ? 360 : vw - 32
  if (!r) return { bottom: 'max(env(safe-area-inset-bottom), 24px)', left: `${(vw - width) / 2}px`, width: `${width}px` }
  if (wide && r.left + r.width < 300 && vw - (r.left + r.width) > width + 40) {
    const top = Math.min(Math.max(16, r.top - 12), vh - 260)
    return { top: `${top}px`, left: `${r.left + r.width + PAD + GAP}px`, width: `${width}px` }
  }
  const left = wide ? Math.min(Math.max(16, r.left), vw - width - 16) : 16
  const below = vh - (r.top + r.height) - PAD
  const above = r.top - PAD
  if (below >= 230 || below >= above) return { top: `${r.top + r.height + PAD + GAP}px`, left: `${left}px`, width: `${width}px` }
  return { bottom: `${vh - r.top + PAD + GAP}px`, left: `${left}px`, width: `${width}px` }
})

function onKey(e: KeyboardEvent) {
  if (!tour.open.value) return
  if (e.key === 'Escape') finish()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="step" class="fixed inset-0 z-[85]" data-cy="patient-tour">
    <!-- Catches every tap outside the card, the lit element included -->
    <div class="absolute inset-0" :class="hole ? '' : 'bg-black/55'" @click.stop />
    <div
      v-if="hole"
      class="pointer-events-none absolute rounded-[20px] shadow-[0_0_0_200vmax_rgba(10,14,18,0.58)] transition-all duration-300 ease-out motion-reduce:transition-none"
      :style="hole"
      aria-hidden="true"
    />
    <div
      v-if="card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-tour-title"
      aria-describedby="patient-tour-body"
      class="absolute rounded-[20px] bg-surface p-5 shadow-popover transition-[top,bottom,left] duration-300 ease-out motion-reduce:transition-none"
      :style="card"
    >
      <div class="flex items-center gap-1.5" aria-hidden="true">
        <span
          v-for="(s, i) in steps"
          :key="s.key"
          class="h-1.5 rounded-full transition-all duration-300"
          :class="i === index ? 'w-5 bg-brand' : 'w-1.5 bg-chip-bg'"
        />
      </div>
      <p class="sr-only">{{ t(`Step ${index + 1} of ${steps.length}`, `Paso ${index + 1} de ${steps.length}`) }}</p>
      <h2 id="patient-tour-title" class="mt-3 text-[17px] font-semibold text-ink-900">{{ step.title }}</h2>
      <p id="patient-tour-body" class="mt-1.5 text-[14.5px] leading-[1.5] text-ink-700">{{ step.body }}</p>
      <div class="mt-4 flex items-center gap-2">
        <AppButton v-if="!last" variant="quiet" class="-ml-3" data-cy="patient-tour-skip" @click="finish">{{ t('Skip', 'Saltar') }}</AppButton>
        <div class="flex-1" />
        <AppButton v-if="index > 0" variant="secondary" data-cy="patient-tour-back" @click="back">{{ t('Back', 'Atrás') }}</AppButton>
        <AppButton ref="primary" variant="primary" class="px-5" data-cy="patient-tour-next" @click="next">
          {{ last ? t('Got it', 'Entendido') : t('Continue', 'Siguiente') }}
        </AppButton>
      </div>
    </div>
  </div>
</template>
