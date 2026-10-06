<script setup lang="ts">
// The patient record on the staff app: who they are and what to watch for
// before walking in, then what has been happening.
//
// Everything follows the person's role, the way the web record does:
//   - money (bonos, balance) only with billing_history_view, the key that
//     gates the web's Money tab;
//   - recent visits and their notes only with visit_notes_access (and RLS on
//     visit_notes says the same);
//   - files as RLS returns them (docs_files_scope);
//   - Book not offered on a read-only calendar or with no calendar at all;
//   - WhatsApp only with inbox_access, and never to a minor or a
//     do-not-contact patient (the web hides every send entry point for them).
// Reads go through the same RLS as the web, and every figure about money
// comes from usePatientFinancialSummary -- the composable behind the web's
// balance pill and Billing tab -- never from arithmetic of its own here.
//
// Each section loads on its own, in parallel, with its own skeleton and its
// own error, so a slow or failing one does not hold up or blank the rest.
import { formatEur } from '../../../utils/billing'
import { formatPhoneDisplay, toE164 } from '../../../utils/phone'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const router = useRouter()
const patientId = route.params.id as string
const supabase = useSupabaseClient()
const config = useRuntimeConfig()
const t = useT()
const { context, loading: contextLoading, can, restricted, ownDiaryOnly } = usePractitionerContext()

interface Patient {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  date_of_birth: string | null
  created_at: string
  photo_storage_path: string | null
  red_flags: string | null
  yellow_flags: string | null
  sticky_note: string | null
  is_minor: boolean
  do_not_contact: boolean
  practitioner: { full_name: string } | null
  clinic: { timezone: string | null } | null
}
interface ContactNumber { id: string; number: string; country_code: string; is_whatsapp: boolean }

const locale = computed(() => t('en-GB', 'es-ES'))

// -- The patient: header, alerts ----------------------------------------------
const patient = ref<Patient | null>(null)
const patientLoading = ref(true)
const patientError = ref('')
async function loadPatient() {
  const { data, error } = await supabase
    .from('patients')
    .select(
      'id, first_name, last_name, email, date_of_birth, created_at, photo_storage_path, red_flags, yellow_flags, sticky_note, is_minor, do_not_contact, practitioner:team_members!patients_default_practitioner_id_fkey(full_name), clinic:clinics(timezone)',
    )
    .eq('id', patientId)
    .maybeSingle()
  if (error) patientError.value = t('Could not load this patient.', 'No se ha podido cargar el paciente.')
  patient.value = (data as unknown as Patient) ?? null
  patientLoading.value = false
}

const timeZone = computed(() => patient.value?.clinic?.timezone || DEFAULT_CLINIC_TIMEZONE)
const fullName = computed(() => [patient.value?.first_name, patient.value?.last_name].filter(Boolean).join(' '))
const initials = computed(() => [patient.value?.first_name?.[0], patient.value?.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?')
const photoUrl = computed(() =>
  patient.value?.photo_storage_path ? supabase.storage.from('patient-photos').getPublicUrl(patient.value.photo_storage_path).data.publicUrl : null,
)
const photoFailed = ref(false)

const age = computed(() => {
  if (!patient.value?.date_of_birth) return null
  const dob = new Date(patient.value.date_of_birth)
  const now = new Date()
  let years = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--
  return years
})
const identityLine = computed(() => {
  if (!patient.value) return ''
  const since = new Date(patient.value.created_at).toLocaleDateString(locale.value, { month: 'short', year: 'numeric' })
  return [age.value !== null ? String(age.value) : null, `${t('patient since', 'paciente desde')} ${since}`, patient.value.practitioner?.full_name ?? null]
    .filter(Boolean)
    .join(' · ')
})

const alerts = computed(() => {
  const p = patient.value
  if (!p) return []
  const rows: { key: string; tone: 'danger' | 'warning' | 'note'; text: string }[] = []
  if (p.red_flags?.trim()) rows.push({ key: 'red', tone: 'danger', text: p.red_flags.trim() })
  if (p.yellow_flags?.trim()) rows.push({ key: 'yellow', tone: 'warning', text: p.yellow_flags.trim() })
  if (p.sticky_note?.trim()) rows.push({ key: 'note', tone: 'note', text: p.sticky_note.trim() })
  return rows
})

// Minors and do-not-contact patients get no messages from anywhere.
const canContact = computed(() => !!patient.value && !patient.value.is_minor && !patient.value.do_not_contact)

// -- Contact numbers --------------------------------------------------------
const numbers = ref<ContactNumber[]>([])
const numbersLoading = ref(true)
const numbersError = ref('')
async function loadNumbers() {
  const { data, error } = await supabase.from('patient_contact_numbers').select('id, number, country_code, is_whatsapp').eq('patient_id', patientId).order('created_at')
  if (error) numbersError.value = t('Could not load the contact numbers.', 'No se han podido cargar los teléfonos.')
  numbers.value = (data as ContactNumber[]) ?? []
  numbersLoading.value = false
}
const primaryNumber = computed(() => numbers.value[0] ?? null)
const whatsappNumber = computed(() => numbers.value.find((n) => n.is_whatsapp) ?? null)
function telHref(n: ContactNumber) {
  return `tel:${formatPhoneDisplay(n.number, n.country_code).replace(/[^\d+]/g, '')}`
}

// -- Care plan and the next visit -------------------------------------------
interface Plan { id: string; name: string; total_visits: number; frequency_value: number; frequency_unit: string; started_at: string }
interface NextAppt { id: string; starts_at: string; appointment_types: { name: string } | null }
const plan = ref<Plan | null>(null)
const completedInPlan = ref(0)
const nextAppt = ref<NextAppt | null>(null)
const planLoading = ref(true)
const planError = ref('')
async function loadPlan() {
  planError.value = ''
  const [{ data: plans, error: planErr }, { data: upcoming, error: apptErr }] = await Promise.all([
    supabase.from('care_plans').select('id, name, total_visits, frequency_value, frequency_unit, started_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1),
    supabase
      .from('appointments')
      .select('id, starts_at, appointment_types(name)')
      .eq('patient_id', patientId)
      .eq('status', 'booked')
      .is('deleted_at', null)
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(1),
  ])
  plan.value = ((plans as Plan[] | null) ?? [])[0] ?? null
  nextAppt.value = ((upcoming as unknown as NextAppt[] | null) ?? [])[0] ?? null
  // Visits completed SINCE THE PLAN STARTED, as care_plan_continuity_alerts
  // (0131) and PhaseStats count them -- not every visit the patient has ever
  // had, which would put a returning patient's new plan half done on day one.
  if (plan.value) {
    const { count, error } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .gte('starts_at', plan.value.started_at)
    if (error) planError.value = t('Could not load the care plan.', 'No se ha podido cargar el plan.')
    completedInPlan.value = count ?? 0
  }
  if (planErr || apptErr) planError.value = t('Could not load the care plan.', 'No se ha podido cargar el plan.')
  planLoading.value = false
}
const planPercent = computed(() => (plan.value && plan.value.total_visits > 0 ? Math.min(100, Math.round((completedInPlan.value / plan.value.total_visits) * 100)) : 0))
function apptWhen(iso: string) {
  const d = new Date(iso)
  return `${shortDayLabel(d, locale.value, timeZone.value)} ${clinicTimeLabel(d, timeZone.value)}`
}

// -- Money: bonos and balance (billing_history_view) -------------------------
const showMoney = computed(() => can('billing_history_view'))
// Handed an empty id until the role is known to see money, so nothing is
// fetched for a role that does not.
const money = usePatientFinancialSummary(() => (showMoney.value ? patientId : ''))
// The composable keeps what it loaded for the life of the app, and the app
// stays open all day: a balance read this morning is not the balance now.
// Refreshed on arrival unless a load is already under way.
watch(showMoney, (visible) => {
  if (visible && !money.loading.value) money.refresh()
}, { immediate: true })
const bonoSummary = computed(() => {
  const list = money.activePackages.value
  if (list.length === 0) return null
  const left = list.reduce((sum, p) => sum + Math.max(0, p.sessions_total - p.sessions_used), 0)
  const sub = list.length === 1 ? `${list[0].package_name}${list[0].shared && list[0].ownerName ? ` · ${t('shared by', 'de')} ${list[0].ownerName}` : ''}` : t(`${list.length} bonos`, `${list.length} bonos`)
  return { left, sub }
})

// -- Forms (patient_docs) -----------------------------------------------------
const receptionOpen = ref(false)
interface Doc { id: string; title: string; completed_at: string | null; public_token: string | null }
const docs = ref<Doc[]>([])
const docsLoading = ref(true)
const docsError = ref('')
async function loadDocs() {
  const { data, error } = await supabase.from('patient_docs').select('id, title, completed_at, public_token').eq('patient_id', patientId).order('created_at', { ascending: false })
  if (error) docsError.value = t('Could not load the forms.', 'No se han podido cargar los formularios.')
  docs.value = (data as unknown as Doc[]) ?? []
  docsLoading.value = false
}
// The web's own send path for a form (DocsTab.sendViaWhatsApp): its public
// link in a wa.me message from the phone's WhatsApp. The link points at the
// deployed app, not at the WebView's own origin.
const docSendDigits = computed(() => {
  const n = whatsappNumber.value ?? primaryNumber.value
  return n ? toE164(n.number, n.country_code) : null
})
function sendDoc(doc: Doc) {
  if (!doc.public_token || !docSendDigits.value) return
  const link = `${(config.public as { apiBase?: string }).apiBase ?? ''}/doc/${doc.public_token}`
  const message = `${t('Hi! Please complete this document:', '¡Hola! Por favor completa este documento:')} ${link}`
  const url = `https://wa.me/${docSendDigits.value}?text=${encodeURIComponent(message)}`
  openWhenReady(async () => url)
}

// -- Actions ------------------------------------------------------------------
const canBook = computed(() => {
  if (!context.value || restricted('calendar_read_only')) return false
  return context.value.isOwner || context.value.permissions.calendar_scope !== 'none'
})
const canWhatsApp = computed(() => canContact.value && can('inbox_access') && !!whatsappNumber.value)

// The app's own Inbox thread with this patient, which sends through the same
// route as the web Inbox and holds the same 24-hour rule.
function openWhatsApp() {
  pendingConversationKey.value = patientId
  navigateTo('/inbox')
}

const actionCount = computed(() => [!!primaryNumber.value, canWhatsApp.value, canBook.value].filter(Boolean).length)

const bookOpen = ref(false)
const bookedNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function onBooked(e: { startsAt: string }) {
  bookOpen.value = false
  bookedNotice.value = `${t('Booked', 'Reservada')} ${apptWhen(e.startsAt)}`
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (bookedNotice.value = ''), 5000)
  loadPlan()
}

// /patients/<id>?book=1 opens the sheet on arrival (My Day links here). The
// query is taken off again so going back, or a reload, does not reopen it.
watch(
  [() => route.query.book, contextLoading],
  ([book, busy]) => {
    if (book !== '1' || busy) return
    if (canBook.value) bookOpen.value = true
    const { book: _drop, ...rest } = route.query
    router.replace({ query: rest })
  },
  { immediate: true },
)

function goBack() {
  if (window.history.state?.back) router.back()
  else navigateTo('/patients')
}

onMounted(() => {
  loadPatient()
  loadNumbers()
  loadPlan()
  loadDocs()
})
onBeforeUnmount(() => clearTimeout(noticeTimer))
</script>

<template>
  <!-- A wide iPad keeps the patients list beside the record. -->
  <div class="flex h-full min-h-0">
  <StaffPatientList class="hidden lg:flex lg:w-80 lg:shrink-0 lg:border-r lg:border-line" :selected-id="patientId" />
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-brand-text lg:hidden" :aria-label="t('Back', 'Atrás')" @click="goBack">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <p class="truncate text-[16px] font-semibold text-ink-900 lg:pl-2">{{ t('Patient', 'Paciente') }}</p>
    </div>

    <p v-if="!patientLoading && !patient" class="flex flex-1 items-center justify-center px-6 text-center text-sm" :class="patientError ? 'text-danger-text' : 'text-ink-muted'">
      {{ patientError || t('Patient not found.', 'Paciente no encontrado.') }}
    </p>

    <div v-else class="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3 md:px-6 md:py-4" data-cy="patient-record">
      <!-- Who -->
      <div v-if="patientLoading" class="flex items-center gap-3">
        <UiSkeleton class="h-[52px] w-[52px] shrink-0 rounded-full" />
        <div class="flex-1 space-y-1.5">
          <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-56 rounded-ctlSm" />
        </div>
      </div>
      <div v-else-if="patient" class="flex items-center gap-3">
        <img v-if="photoUrl && !photoFailed" :src="photoUrl" alt="" class="h-[52px] w-[52px] shrink-0 rounded-full object-cover" @error="photoFailed = true" />
        <span v-else class="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[17px] font-bold text-brand-text">{{ initials }}</span>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-[17px] font-semibold text-ink-900" data-cy="patient-name">{{ fullName }}</h1>
          <p class="truncate text-[12.5px] text-ink-muted2">{{ identityLine }}</p>
        </div>
      </div>

      <!-- Call / WhatsApp / Book -->
      <div v-if="patient && actionCount > 0" class="grid gap-[7px]" :style="{ gridTemplateColumns: `repeat(${actionCount}, minmax(0, 1fr))` }">
        <a v-if="primaryNumber" :href="telHref(primaryNumber)" class="flex h-10 items-center justify-center gap-1.5 rounded-[11px] border border-line-control bg-surface text-[14px] font-medium text-ink-700" data-cy="patient-call">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3.2 2h2.4l1.2 3-1.6 1a8 8 0 004.8 4.8l1-1.6 3 1.2v2.4A1.2 1.2 0 0112.8 14 10.8 10.8 0 012 3.2 1.2 1.2 0 013.2 2z" stroke-linejoin="round" /></svg>
          {{ t('Call', 'Llamar') }}
        </a>
        <button v-if="canWhatsApp" type="button" class="flex h-10 items-center justify-center gap-1.5 rounded-[11px] border border-line-control bg-surface text-[14px] font-medium text-ink-700" data-cy="patient-whatsapp" @click="openWhatsApp">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.5 13.5l.8-2.6A5.8 5.8 0 118 13.8a5.8 5.8 0 01-2.9-.8z" stroke-linejoin="round" /></svg>
          WhatsApp
        </button>
        <button v-if="canBook" type="button" class="flex h-10 items-center justify-center rounded-[11px] bg-brand text-[14px] font-semibold text-white" data-cy="patient-book" @click="bookOpen = true">
          {{ t('Book', 'Reservar') }}
        </button>
      </div>

      <p v-if="bookedNotice" class="rounded-[11px] border border-success-border bg-success-bg px-3 py-2 text-[13px] font-medium text-success-text" role="status" data-cy="patient-booked-notice">{{ bookedNotice }}</p>

      <!-- Alerts: red and yellow flags, and the sticky note -->
      <section v-if="alerts.length > 0" class="rounded-[13px] border border-danger-border bg-danger-bg2 px-3.5 py-3" data-cy="patient-alerts">
        <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-danger-text">{{ t('Alerts', 'Alertas') }}</h2>
        <ul class="mt-1.5 space-y-1.5">
          <li v-for="a in alerts" :key="a.key" class="flex gap-2 text-[13.5px] leading-snug text-ink-900">
            <svg v-if="a.tone !== 'note'" width="15" height="15" viewBox="0 0 16 16" fill="none" class="mt-[2px] shrink-0" :class="a.tone === 'danger' ? 'text-danger-text' : 'text-warning-accent'" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M8 2l6.2 11H1.8z" stroke-linejoin="round" /><path d="M8 6.5v3M8 11.5v.1" stroke-linecap="round" />
            </svg>
            <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none" class="mt-[2px] shrink-0 text-warning-text" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M3 2.5h10v7.5l-3 3.5H3z" stroke-linejoin="round" /><path d="M10 13.5V10h3" stroke-linejoin="round" />
            </svg>
            <span class="min-w-0 whitespace-pre-wrap">
              <span class="sr-only">{{ a.tone === 'danger' ? t('Red flag:', 'Señal roja:') : a.tone === 'warning' ? t('Yellow flag:', 'Señal amarilla:') : t('Note:', 'Nota:') }}</span>{{ a.text }}
            </span>
          </li>
        </ul>
      </section>

      <!-- Care plan, or just the next visit when there is no plan -->
      <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3" data-cy="patient-plan">
        <template v-if="planLoading">
          <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          <UiSkeleton class="mt-2.5 h-4 w-32 rounded-ctlSm" />
          <UiSkeleton class="mt-2 h-[7px] w-full rounded-full" />
        </template>
        <p v-else-if="planError" class="text-[13px] text-danger-text">{{ planError }}</p>
        <template v-else>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ plan ? t('Care plan', 'Plan de tratamiento') : t('Next visit', 'Próxima visita') }}</h2>
            <span v-if="plan" class="text-[12.5px] text-ink-muted2">{{ cadenceLabel(plan, t) }}</span>
          </div>
          <!-- With calendar_scope 'own' the visits a colleague saw are not
               readable here, so the count would come out short: "visit 2 of
               12" on a plan half done. The plan's length instead, as the
               visit screen does. -->
          <p v-if="plan && ownDiaryOnly" class="mt-1 text-[14px] font-semibold text-ink-900" data-cy="patient-plan-progress">
            {{ t(`${plan.total_visits} visits`, `${plan.total_visits} visitas`) }}
          </p>
          <template v-else-if="plan">
            <p class="mt-1 text-[14px] font-semibold text-ink-900" data-cy="patient-plan-progress">
              {{ t('Visit', 'Visita') }} {{ Math.min(completedInPlan, plan.total_visits) }} {{ t('of', 'de') }} {{ plan.total_visits }}
            </p>
            <div class="mt-1.5 h-[7px] overflow-hidden rounded-full bg-brand-tint">
              <div class="h-full rounded-full bg-brand" :style="{ width: `${planPercent}%` }" />
            </div>
          </template>
          <p class="mt-1.5 text-[12.5px]" :class="nextAppt ? 'text-ink-muted2' : 'text-warning-text'">
            <template v-if="nextAppt">{{ t('Next', 'Próxima') }}: {{ apptWhen(nextAppt.starts_at) }}<template v-if="nextAppt.appointment_types?.name"> · {{ nextAppt.appointment_types.name }}</template></template>
            <template v-else-if="ownDiaryOnly">{{ t('Nothing booked with you.', 'Nada reservado contigo.') }}</template>
            <template v-else>{{ t('Nothing booked.', 'Nada reservado.') }}</template>
          </p>
        </template>
      </section>

      <!-- Bonos and balance: only for a role that sees money -->
      <div v-if="contextLoading" class="grid grid-cols-2 gap-2">
        <UiSkeleton class="h-[74px] rounded-[13px]" />
        <UiSkeleton class="h-[74px] rounded-[13px]" />
      </div>
      <div v-else-if="showMoney" class="grid grid-cols-2 gap-2" data-cy="patient-money">
        <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3">
          <h2 class="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('Bonos', 'Bonos') }}</h2>
          <template v-if="money.loading.value">
            <UiSkeleton class="h-4 w-24 rounded-ctlSm" />
            <UiSkeleton class="mt-1.5 h-3 w-16 rounded-ctlSm" />
          </template>
          <template v-else-if="bonoSummary">
            <p class="text-[14px] font-semibold text-ink-900" data-cy="patient-bonos">{{ bonoSummary.left }} {{ bonoSummary.left === 1 ? t('session left', 'sesión') : t('sessions left', 'sesiones') }}</p>
            <p class="truncate text-[12.5px] text-ink-muted2">{{ bonoSummary.sub }}</p>
          </template>
          <template v-else>
            <p class="text-[14px] font-semibold text-ink-900" data-cy="patient-bonos">{{ t('None active', 'Ninguno activo') }}</p>
          </template>
        </section>
        <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3">
          <h2 class="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('Balance', 'Saldo') }}</h2>
          <template v-if="money.loading.value">
            <UiSkeleton class="h-4 w-24 rounded-ctlSm" />
            <UiSkeleton class="mt-1.5 h-3 w-16 rounded-ctlSm" />
          </template>
          <template v-else-if="money.outstandingCents.value > 0">
            <p class="text-[14px] font-semibold text-danger-text" data-cy="patient-balance">{{ formatEur(money.outstandingCents.value) }} {{ t('due', 'pendiente') }}</p>
            <p class="truncate text-[12.5px] text-ink-muted2">{{ t('Unpaid charges', 'Cargos sin pagar') }}</p>
          </template>
          <template v-else>
            <p class="text-[14px] font-semibold text-success-text" data-cy="patient-balance">{{ t('Up to date', 'Al día') }}</p>
            <p class="truncate text-[12.5px] text-ink-muted2">
              {{ money.availableCents.value > 0 ? `${formatEur(money.availableCents.value)} ${t('available', 'disponible')}` : `${formatEur(0)} ${t('due', 'pendiente')}` }}
            </p>
          </template>
        </section>
      </div>

      <!-- Forms -->
      <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3" data-cy="patient-forms">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('Forms', 'Formularios') }}</h2>
          <!-- Hand the iPad to the patient to fill in and sign their forms -->
          <button type="button" class="inline-flex h-7 items-center gap-1 rounded-pill bg-brand-tint px-2.5 text-[12px] font-semibold text-brand-text" data-cy="patient-reception" @click="receptionOpen = true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20c4-1 5-7 9-11l3 3c-4 4-10 5-11 9" /><path d="M14 8l2-2 2 2-2 2" /></svg>
            {{ t('Sign at reception', 'Firmar en recepción') }}
          </button>
        </div>
        <div v-if="docsLoading" class="mt-2 space-y-2">
          <UiSkeleton class="h-4 w-full rounded-ctlSm" />
          <UiSkeleton class="h-4 w-full rounded-ctlSm" />
        </div>
        <p v-else-if="docsError" class="mt-1.5 text-[13px] text-danger-text">{{ docsError }}</p>
        <p v-else-if="docs.length === 0" class="mt-1.5 text-[13px] text-ink-faint">{{ t('No forms yet.', 'Aún no hay formularios.') }}</p>
        <ul v-else class="mt-1.5 space-y-1.5">
          <li v-for="d in docs" :key="d.id" class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate text-[13.5px] text-ink-900">{{ d.title }}</span>
            <span v-if="d.completed_at" class="inline-flex h-6 shrink-0 items-center rounded-pill bg-success-bg px-2.5 text-[11.5px] font-semibold text-success-text">{{ t('Signed', 'Firmado') }}</span>
            <button
              v-else-if="canContact && docSendDigits && d.public_token"
              type="button"
              class="inline-flex h-7 shrink-0 items-center rounded-pill bg-warning-bg px-2.5 text-[11.5px] font-semibold text-warning-text"
              data-cy="patient-form-send"
              @click="sendDoc(d)"
            >
              {{ t('Not signed · Send', 'Sin firmar · Enviar') }}
            </button>
            <span v-else class="inline-flex h-6 shrink-0 items-center rounded-pill bg-warning-bg px-2.5 text-[11.5px] font-semibold text-warning-text">{{ t('Not signed', 'Sin firmar') }}</span>
          </li>
        </ul>
      </section>

      <!-- Recent visits and their notes: clinical access only -->
      <StaffPatientVisits v-if="!contextLoading && can('visit_notes_access')" :patient-id="patientId" :time-zone="timeZone" />

      <!-- Files, as RLS returns them for this role -->
      <StaffPatientFiles v-if="context" :patient-id="patientId" :account-id="context.accountId" :team-member-id="context.teamMemberId" />

      <!-- Contact -->
      <section class="rounded-[13px] border border-line bg-surface px-3.5 py-3" data-cy="patient-contact">
        <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('Contact', 'Contacto') }}</h2>
        <div v-if="numbersLoading || patientLoading" class="mt-2 space-y-1.5">
          <UiSkeleton class="h-4 w-44 rounded-ctlSm" />
          <UiSkeleton class="h-4 w-52 rounded-ctlSm" />
        </div>
        <template v-else>
          <p v-if="numbersError" class="mt-1.5 text-[13px] text-danger-text">{{ numbersError }}</p>
          <a v-for="n in numbers" :key="n.id" :href="telHref(n)" class="mt-1 flex items-center gap-1.5 text-[13.5px] text-ink-900">
            <span class="tabular-nums">{{ formatPhoneDisplay(n.number, n.country_code) }}</span>
            <span v-if="n.is_whatsapp" class="text-[12px] text-success-text">· WhatsApp</span>
          </a>
          <a v-if="patient?.email" :href="`mailto:${patient.email}`" class="mt-1 block truncate text-[13.5px] text-ink-900">{{ patient.email }}</a>
          <p v-if="!patient?.email && numbers.length === 0 && !numbersError" class="mt-1.5 text-[13px] text-ink-faint">{{ t('No contact details on file.', 'No hay datos de contacto.') }}</p>
        </template>
      </section>
    </div>

    <BookVisitSheet v-if="bookOpen" :patient-id="patientId" @booked="onBooked" @close="bookOpen = false" />
    <ReceptionSetupSheet v-if="receptionOpen" :patient-id="patientId" @close="receptionOpen = false" />
  </div>
  </div>
</template>
