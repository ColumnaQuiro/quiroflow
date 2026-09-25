<script setup lang="ts">
import { hasBusinessHoursConfigured, type BusinessHours } from '~/utils/businessHours'
import { hoursProblems, normalizeHours } from '~/utils/clinicHours'
import { looksLikePhoneNumber } from '~/utils/phone'

// One clinic, everything about it on one page: what used to be spread over
// Clinics (name, address, slot), Online Booking (opening hours) and Fiscal
// Data (legal name, NIF, footer), plus the contact details patients see and
// a way to close a location that does not erase its diary.
//
// One Guardar for the page. The old table saved each field on blur, silently,
// and ignored the error -- a failed save looked exactly like a good one.

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { showToast } = useToast()
const clinicId = route.params.id as string

interface Form {
  name: string
  address: string
  phone: string
  email: string
  business_hours: BusinessHours
  timezone: string
  slot_duration_minutes: number
  legal_name: string
  tax_id: string
  invoice_footer_text: string
}

const loaded = ref(false)
const missing = ref(false)
const form = ref<Form | null>(null)
const original = ref('')
const onlineBooking = ref(false)
const logoPath = ref<string | null>(null)
const archivedAt = ref<string | null>(null)

const practitioners = ref<{ id: string; full_name: string; ownHours: boolean }[]>([])
const upcomingCount = ref(0)
const appointmentCount = ref(0)
const otherActiveCount = ref(0)

function toForm(c: any): Form {
  return {
    name: c.name ?? '',
    address: c.address ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    business_hours: normalizeHours(c.business_hours as BusinessHours | null),
    timezone: c.timezone ?? 'Europe/Madrid',
    slot_duration_minutes: c.slot_duration_minutes ?? 15,
    legal_name: c.legal_name ?? '',
    tax_id: c.tax_id ?? '',
    invoice_footer_text: c.invoice_footer_text ?? '',
  }
}

async function load() {
  const { data: c, error } = await supabase
    .from('clinics')
    .select('id, name, address, phone, email, business_hours, timezone, slot_duration_minutes, legal_name, tax_id, invoice_footer_text, logo_storage_path, online_booking_enabled, archived_at, account_id')
    .eq('id', clinicId)
    .maybeSingle()
  if (error || !c) {
    missing.value = true
    loaded.value = true
    return
  }
  form.value = toForm(c)
  original.value = JSON.stringify(form.value)
  onlineBooking.value = c.online_booking_enabled
  logoPath.value = c.logo_storage_path
  archivedAt.value = c.archived_at
  loaded.value = true
  loadContext()
}

async function loadContext() {
  const now = new Date().toISOString()
  const [links, upcoming, all, others] = await Promise.all([
    supabase.from('team_member_clinics').select('team_members(id, full_name, is_practitioner, deleted_at, business_hours)').eq('clinic_id', clinicId),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .not('status', 'in', '(cancelled,no_show)')
      .gt('starts_at', now),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
    supabase.from('clinics').select('id', { count: 'exact', head: true }).is('archived_at', null).neq('id', clinicId),
  ])
  practitioners.value = ((links.data ?? []) as any[])
    .map((l) => l.team_members)
    .filter((m) => m && m.is_practitioner && !m.deleted_at)
    .map((m) => ({ id: m.id, full_name: m.full_name, ownHours: hasBusinessHoursConfigured(m.business_hours as BusinessHours | null) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))
  upcomingCount.value = upcoming.count ?? 0
  appointmentCount.value = all.count ?? 0
  otherActiveCount.value = others.count ?? 0
}

onMounted(load)

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)
// Closures are whole days in the zone the clinic is saved in, not one still
// being chosen above.
const savedTimezone = computed(() => (original.value ? (JSON.parse(original.value) as Form).timezone : 'Europe/Madrid'))
const problems = computed(() => (form.value ? hoursProblems(form.value.business_hours) : {}))
const withOwnHours = computed(() => practitioners.value.filter((p) => p.ownHours))
const withoutOwnHours = computed(() => practitioners.value.filter((p) => !p.ownHours))
const fiscalIncomplete = computed(() => !!form.value && (!form.value.legal_name.trim() || !form.value.tax_id.trim()))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailBad = computed(() => !!form.value?.email.trim() && !EMAIL.test(form.value.email.trim()))
const phoneBad = computed(() => !!form.value?.phone.trim() && !looksLikePhoneNumber(form.value.phone.trim(), store.defaultPhoneCountry))
const nameMissing = computed(() => !!form.value && !form.value.name.trim())
const canSave = computed(() => !nameMissing.value && !emailBad.value && !phoneBad.value && Object.keys(problems.value).length === 0)

// --- Save / discard -------------------------------------------------------------
const saving = ref(false)
const tried = ref(false)
async function save() {
  if (!form.value) return
  tried.value = true
  if (!canSave.value) {
    showToast(t('Some fields need fixing before this can be saved.', 'Hay campos por corregir antes de guardar.'), 'error')
    return
  }
  saving.value = true
  const f = form.value
  const values = {
    name: f.name.trim(),
    address: f.address.trim() || null,
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    business_hours: f.business_hours,
    timezone: f.timezone,
    slot_duration_minutes: f.slot_duration_minutes,
    legal_name: f.legal_name.trim() || null,
    tax_id: f.tax_id.trim() || null,
    invoice_footer_text: f.invoice_footer_text.trim() || null,
  }
  const { error } = await supabase.from('clinics').update(values).eq('id', clinicId).select('id').single()
  saving.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  tried.value = false
  original.value = JSON.stringify(f)
  // The switcher, the calendar's grid and the booking hours read the store's
  // copy; patch it rather than reloading the whole account.
  const inStore = store.clinics.find((c) => c.id === clinicId)
  if (inStore) {
    Object.assign(inStore, {
      name: values.name,
      address: values.address,
      business_hours: values.business_hours,
      slot_duration_minutes: values.slot_duration_minutes,
      legal_name: values.legal_name,
      tax_id: values.tax_id,
      invoice_footer_text: values.invoice_footer_text,
    })
  }
  showToast(t('Saved', 'Guardado'))
}
function discard() {
  form.value = JSON.parse(original.value)
  tried.value = false
}

// --- Leaving with unsaved changes -------------------------------------------------
const pendingLeave = ref<string | null>(null)
onBeforeRouteLeave((to) => {
  if (!dirty.value || pendingLeave.value === to.fullPath) return true
  pendingLeave.value = to.fullPath
  leaveOpen.value = true
  return false
})
const leaveOpen = ref(false)
function leaveAnyway() {
  const to = pendingLeave.value
  leaveOpen.value = false
  if (to) router.push(to)
}
function stayHere() {
  leaveOpen.value = false
  pendingLeave.value = null
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

// --- Logo (saved as soon as it is uploaded) ------------------------------------------
async function onLogoUploaded() {
  const { data } = await supabase.from('clinics').select('logo_storage_path').eq('id', clinicId).maybeSingle()
  logoPath.value = data?.logo_storage_path ?? null
  const inStore = store.clinics.find((c) => c.id === clinicId)
  if (inStore) inStore.logo_storage_path = logoPath.value
}

// --- Archive / delete -------------------------------------------------------------
const archiveOpen = ref(false)
const deleteOpen = ref(false)
const closing = ref(false)

async function afterClosing(message: string) {
  if (store.currentClinicId === clinicId) {
    const next = store.clinics.find((c) => c.id !== clinicId)
    if (next) store.setCurrentClinic(next.id)
  }
  await store.load()
  showToast(message)
  pendingLeave.value = '/settings/clinics'
  router.push('/settings/clinics')
}

async function archive() {
  closing.value = true
  // Off online booking too, so nothing can be booked there from here on.
  const { error } = await supabase.from('clinics').update({ archived_at: new Date().toISOString(), online_booking_enabled: false }).eq('id', clinicId)
  closing.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  archiveOpen.value = false
  await afterClosing(t(`${form.value?.name} archived.`, `${form.value?.name} archivada.`))
}

async function remove() {
  closing.value = true
  const { error } = await supabase.from('clinics').delete().eq('id', clinicId)
  closing.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  deleteOpen.value = false
  await afterClosing(t(`${form.value?.name} deleted.`, `${form.value?.name} eliminada.`))
}

async function reactivate() {
  const { error } = await supabase.from('clinics').update({ archived_at: null }).eq('id', clinicId)
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  archivedAt.value = null
  await store.load()
  showToast(t('Active again.', 'Vuelve a estar activa.'))
}

const SLOTS = [10, 15, 20, 30, 60]
const SECTIONS = computed(() => [
  { id: 'sede', label: t('The location', 'La sede') },
  { id: 'contacto', label: t('Contact', 'Contacto') },
  { id: 'horario', label: t('Hours', 'Horario') },
  { id: 'cierres', label: t('Closures', 'Cierres') },
  { id: 'zona', label: t('Time zone', 'Zona horaria') },
  { id: 'fiscal', label: t('Billing details', 'Datos fiscales'), flag: fiscalIncomplete.value },
  { id: 'logo', label: t('Logo', 'Logotipo') },
  ...(archivedAt.value ? [] : [{ id: 'cerrar', label: t('Close this location', 'Cerrar la sede') }]),
])

const initials = computed(() => (form.value?.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·')
const inputClass = 'h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const hint = 'text-[12.5px] font-normal leading-snug text-ink-muted'
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        <span aria-hidden="true">›</span>
        <NuxtLink to="/settings/clinics" class="font-semibold text-brand-text hover:underline" data-cy="clinic-back">{{ t('Clinics', 'Clínicas') }}</NuxtLink>
      </nav>
      <div v-if="form" class="flex flex-wrap items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-ctl bg-brand-tint text-[14px] font-bold text-brand-text">{{ initials }}</span>
        <h1 class="text-[20px] font-bold text-ink-900" data-cy="clinic-title">{{ form.name || t('Untitled', 'Sin nombre') }}</h1>
        <span v-if="archivedAt" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12.5px] font-bold text-chip-text" data-cy="clinic-archived-chip">{{ t('Archived', 'Archivada') }}</span>
        <NuxtLink
          v-else
          to="/settings/online-booking"
          class="rounded-pill px-2.5 py-0.5 text-[12.5px] font-bold"
          :class="onlineBooking ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
        >
          {{ onlineBooking ? t('Online booking on', 'Reserva online activa') : t('Online booking off', 'Sin reserva online') }}
        </NuxtLink>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6 pb-32">
        <SettingsNav />
        <p v-if="loaded && missing" class="text-[14px] text-ink-muted" data-cy="clinic-missing">
          {{ t('This clinic does not exist, or is not yours.', 'Esta clínica no existe o no es tuya.') }}
          <NuxtLink to="/settings/clinics" class="text-brand-text hover:underline">{{ t('Back to clinics', 'Volver a clínicas') }}</NuxtLink>
        </p>
        <template v-else-if="form">
          <nav :aria-label="t('Sections', 'Secciones')" class="sticky top-0 hidden w-[180px] shrink-0 flex-col gap-0.5 self-start 2xl:flex">
            <a
              v-for="s in SECTIONS"
              :key="s.id"
              :href="`#${s.id}`"
              class="flex min-h-10 items-center justify-between gap-2 rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle"
            >
              {{ s.label }}
              <span v-if="s.flag" class="h-2 w-2 rounded-full bg-warning-accent" :aria-label="t('incomplete', 'incompleto')" />
            </a>
          </nav>

          <main class="flex min-w-0 max-w-[720px] flex-1 flex-col gap-6" data-cy="clinic-page" :data-ready="loaded ? 'true' : undefined">
            <p v-if="archivedAt" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle px-4 py-3 text-[14px] text-ink-700">
              <span class="flex-1">{{ t('Archived: hidden from the clinic switcher, the calendar and online booking. Its history is kept.', 'Archivada: no aparece en el selector de clínica, el calendario ni la reserva online. Su historial se conserva.') }}</span>
              <button type="button" data-cy="clinic-page-reactivate" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="reactivate">
                {{ t('Reactivate', 'Reactivar') }}
              </button>
            </p>

            <!-- La sede -->
            <section id="sede" aria-labelledby="h-sede" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-sede" class="text-[16px] font-bold text-ink-900">{{ t('The location', 'La sede') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('What it is called and where it is.', 'Cómo se llama y dónde está.') }}</p>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input v-model="form.name" data-cy="clinic-name" type="text" :class="[inputClass, tried && nameMissing ? 'border-danger-text' : 'border-line-control']" />
                <span v-if="tried && nameMissing" class="text-[12.5px] font-semibold text-danger-text">{{ t('A location needs a name.', 'La sede necesita un nombre.') }}</span>
                <span v-else :class="hint">{{ t('Your team sees it in the clinic switcher, and patients in online booking.', 'Lo ve tu equipo en el selector de clínica y los pacientes en la reserva online.') }}</span>
              </label>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Address', 'Dirección') }}
                <textarea v-model="form.address" data-cy="clinic-address" rows="2" :class="[inputClass, 'h-[72px] resize-y border-line-control py-2.5 leading-snug']" />
                <span :class="hint">{{ t('Printed on your facturas and receipts, and shown in online booking.', 'Aparece en tus facturas y recibos, y en la reserva online.') }}</span>
              </label>
            </section>

            <!-- Contacto -->
            <section id="contacto" aria-labelledby="h-contacto" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-contacto" class="text-[16px] font-bold text-ink-900">{{ t('Contact', 'Contacto') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('So patients know how to reach this location.', 'Para que los pacientes sepan cómo llegar a vosotros.') }}</p>
              </div>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Phone', 'Teléfono') }}
                  <input v-model="form.phone" data-cy="clinic-phone" type="tel" autocomplete="tel" :class="[inputClass, phoneBad ? 'border-danger-text' : 'border-line-control']" />
                  <span v-if="phoneBad" class="text-[12.5px] font-semibold text-danger-text">{{ t('That does not look like a phone number.', 'Eso no parece un número de teléfono.') }}</span>
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Email', 'Email') }}
                  <input v-model="form.email" data-cy="clinic-email" type="email" autocomplete="email" :class="[inputClass, emailBad ? 'border-danger-text' : 'border-line-control']" />
                  <span v-if="emailBad" class="text-[12.5px] font-semibold text-danger-text">{{ t('That does not look like an email address.', 'Eso no parece un email.') }}</span>
                </label>
              </div>
              <p :class="hint">{{ t('Shown to patients once they have booked online and at the foot of confirmation and reminder emails, and available to WhatsApp templates and automated emails as "Clinic phone" and "Clinic address". Leave them empty to show nothing.', 'Se muestran al paciente cuando reserva online y al pie de los emails de confirmación y recordatorio, y tus plantillas de WhatsApp y emails automáticos pueden usarlos como «Teléfono de la clínica» y «Dirección de la clínica». Déjalos vacíos para no mostrar nada.') }}</p>
            </section>

            <!-- Horario -->
            <section id="horario" aria-labelledby="h-horario" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-horario" class="text-[16px] font-bold text-ink-900">{{ t('Opening hours', 'Horario de apertura') }}</h2>
                <p class="text-[13px] text-ink-muted">
                  {{ t('The default hours: used by the calendar, by online booking with "any practitioner", by the API, and by any practitioner without hours of their own.', 'El horario por defecto: lo usa el calendario, la reserva online con «cualquier profesional», la API y cualquier profesional que no tenga horario propio.') }}
                </p>
              </div>
              <SettingsClinicHoursEditor v-model="form.business_hours" :problems="problems" />
              <!-- A practitioner's own hours are authoritative -- not narrowed
              by these (practitionerWindowsForDay, utils/businessHours.ts) --
              so say who these actually apply to. -->
              <div v-if="practitioners.length > 0" class="flex gap-2.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="clinic-own-hours">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" /></svg>
                <span>
                  <template v-if="withOwnHours.length > 0">
                    <strong>{{ t(`${withOwnHours.length} of ${practitioners.length} practitioners have their own hours`, `${withOwnHours.length} de ${practitioners.length} profesionales tienen horario propio`) }}</strong>{{ t(', and theirs win: these hours neither shorten nor extend them.', ', y el suyo manda: este horario no les aplica, ni para acortarlo ni para alargarlo.') }}
                  </template>
                  <template v-else>
                    <strong>{{ t('No practitioner here has hours of their own', 'Ningún profesional de esta sede tiene horario propio') }}</strong>{{ t(', so these hours apply to all of them.', ', así que este horario les aplica a todos.') }}
                  </template>
                  <template v-if="withOwnHours.length > 0 && withoutOwnHours.length > 0">
                    {{ t(`Using these: ${withoutOwnHours.map((p) => p.full_name).join(', ')}.`, `Usan el de la sede: ${withoutOwnHours.map((p) => p.full_name).join(', ')}.`) }}
                  </template>
                  <NuxtLink to="/settings/team" class="font-semibold text-brand-text hover:underline">{{ t('See hours in Team', 'Ver horarios en Equipo') }}</NuxtLink>
                </span>
              </div>
            </section>

            <!-- Cierres y festivos -->
            <section id="cierres" aria-labelledby="h-cierres" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-cierres" class="text-[16px] font-bold text-ink-900">{{ t('Holidays and closures', 'Cierres y festivos') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('Whole days the location is shut, for everyone. Shown in the calendar and taken out of online booking. Saved as soon as it is added.', 'Días enteros en que la sede cierra, para todo el equipo. Se ven en el calendario y salen de la reserva online. Se guarda al añadirlo.') }}</p>
              </div>
              <SettingsClinicClosures :clinic-id="clinicId" :timezone="savedTimezone" />
            </section>

            <!-- Zona horaria y calendario -->
            <section id="zona" aria-labelledby="h-zona" class="flex scroll-mt-4 flex-col gap-5 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-zona" class="text-[16px] font-bold text-ink-900">{{ t('Time zone and calendar', 'Zona horaria y calendario') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('The location\'s local time.', 'La hora de la sede.') }}</p>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Time zone', 'Zona horaria') }}</span>
                <SettingsTimeZonePicker v-model="form.timezone" />
                <span :class="hint">{{ t('Changing it moves no appointment: each keeps its exact moment. It sets the hours online booking offers and the time printed in confirmation and reminder emails.', 'Cambiarla no mueve ninguna cita: cada una conserva su momento exacto. Decide las horas que ofrece la reserva online y la hora que aparece en los emails de confirmación y recordatorio.') }}</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <span id="slot-label" class="text-[13px] font-semibold text-ink-700">{{ t('Calendar slot', 'Franja del calendario') }}</span>
                <div role="radiogroup" aria-labelledby="slot-label" class="flex flex-wrap gap-1.5">
                  <button
                    v-for="m in SLOTS"
                    :key="m"
                    type="button"
                    role="radio"
                    data-cy="clinic-slot"
                    :data-minutes="m"
                    :aria-checked="form.slot_duration_minutes === m"
                    class="h-11 min-w-[72px] rounded-ctl px-3 text-[14px] font-semibold"
                    :class="form.slot_duration_minutes === m ? 'border-[1.5px] border-brand bg-brand-tint text-brand-text' : 'border border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'"
                    @click="form.slot_duration_minutes = m"
                  >
                    {{ m }} min
                  </button>
                </div>
                <span :class="hint">{{ t('How finely the calendar grid is divided, and the steps when picking a time: 15 min shows 9:00, 9:15, 9:30… It does not change how long an appointment lasts -- appointment types decide that, and each practitioner can adjust them.', 'Cada cuánto se divide la cuadrícula del calendario y los pasos al elegir hora: con 15 min verás 9:00, 9:15, 9:30… No cambia lo que dura una cita: eso lo deciden los tipos de cita, que cada profesional puede ajustar.') }}</span>
              </div>
            </section>

            <!-- Datos fiscales -->
            <section id="fiscal" aria-labelledby="h-fiscal" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex items-start gap-3">
                <div class="flex flex-1 flex-col gap-1">
                  <h2 id="h-fiscal" class="text-[16px] font-bold text-ink-900">{{ t('Billing details', 'Datos fiscales') }}</h2>
                  <p class="text-[13px] text-ink-muted">{{ t('What a factura needs to be valid. Printed on this location\'s facturas and receipts.', 'Lo que exige una factura para ser válida. Se imprime en facturas y recibos de esta sede.') }}</p>
                </div>
                <span v-if="fiscalIncomplete" class="shrink-0 rounded-pill bg-warning-bg px-2.5 py-0.5 text-[12.5px] font-bold text-warning-text" data-cy="clinic-fiscal-incomplete">{{ t('Incomplete', 'Incompleto') }}</span>
              </div>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Legal name', 'Razón social') }}
                  <input v-model="form.legal_name" data-cy="clinic-legal-name" type="text" :class="[inputClass, 'border-line-control']" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Tax ID', 'NIF / CIF') }}
                  <input v-model="form.tax_id" data-cy="clinic-tax-id" type="text" placeholder="B12345678" :class="[inputClass, !form.tax_id.trim() ? 'border-warning-accent' : 'border-line-control']" />
                  <span v-if="!form.tax_id.trim()" class="text-[12.5px] font-semibold text-warning-text">{{ t('Missing. Without it no factura can be issued.', 'Falta. Sin NIF no se pueden emitir facturas.') }}</span>
                </label>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Invoice footer', 'Pie de factura') }}
                <textarea v-model="form.invoice_footer_text" data-cy="clinic-footer" rows="2" :class="[inputClass, 'h-[72px] resize-y border-line-control py-2.5 leading-snug']" />
                <span :class="hint">{{ t('Printed at the foot of facturas and receipts. Changes apply to new facturas; ones already issued keep what they were issued with.', 'Se imprime al pie de facturas y recibos. Los cambios valen para las facturas nuevas; las ya emitidas conservan lo que tenían.') }}</span>
              </label>
            </section>

            <!-- Logotipo -->
            <section id="logo" aria-labelledby="h-logo" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-logo" class="text-[16px] font-bold text-ink-900">{{ t('Logo', 'Logotipo') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('On this location\'s facturas, receipts and online booking. Saved as soon as it is uploaded.', 'Aparece en facturas, recibos y la reserva online de esta sede. Se guarda al subirlo.') }}</p>
              </div>
              <SettingsClinicLogoUpload :clinic-id="clinicId" :logo-storage-path="logoPath" @uploaded="onLogoUploaded" />
            </section>

            <!-- Cerrar -->
            <section v-if="!archivedAt" id="cerrar" aria-labelledby="h-cerrar" class="flex scroll-mt-4 flex-col gap-3 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-cerrar" class="text-[16px] font-bold text-ink-900">{{ t('Close this location', 'Cerrar esta sede') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('For a location you no longer use. None of its history is lost.', 'Para una sede que ya no usáis. Nada de su historial se pierde.') }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-4 rounded-ctl border border-line px-4 py-3.5">
                <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Archive', 'Archivar') }}</strong>
                  <span class="text-[13px] leading-snug text-ink-500">{{ t('Leaves the clinic switcher, the calendar and online booking. Its appointments, patients and facturas are kept, and you can reactivate it whenever you like.', 'Desaparece del selector de clínica, del calendario y de la reserva online. Sus citas, pacientes y facturas se conservan, y puedes reactivarla cuando quieras.') }}</span>
                </div>
                <button type="button" data-cy="clinic-archive" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="archiveOpen = true">
                  {{ t('Archive…', 'Archivar…') }}
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-4 rounded-ctl border border-line px-4 py-3.5">
                <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Delete', 'Eliminar') }}</strong>
                  <span v-if="appointmentCount > 0" class="text-[13px] leading-snug text-ink-500" data-cy="clinic-delete-unavailable">
                    {{ t(`Not available: this location has ${appointmentCount} appointments. Only a location with none, like one created by mistake, can be deleted.`, `No disponible: esta sede tiene ${appointmentCount} citas. Solo se puede eliminar una sede sin ninguna cita, como una creada por error.`) }}
                  </span>
                  <span v-else-if="otherActiveCount === 0" class="text-[13px] leading-snug text-ink-500">
                    {{ t('Not available: it is your only location.', 'No disponible: es tu única sede.') }}
                  </span>
                  <span v-else class="text-[13px] leading-snug text-ink-500">{{ t('It has no appointments, so it can be removed entirely.', 'No tiene citas, así que se puede eliminar del todo.') }}</span>
                </div>
                <button
                  type="button"
                  data-cy="clinic-delete"
                  :disabled="appointmentCount > 0 || otherActiveCount === 0"
                  class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-danger-text hover:bg-surface-subtle disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
                  @click="deleteOpen = true"
                >
                  {{ t('Delete…', 'Eliminar…') }}
                </button>
              </div>
            </section>
          </main>
        </template>
      </div>
    </div>

    <!-- One save for the whole page. -->
    <div
      v-if="dirty"
      role="region"
      :aria-label="t('Unsaved changes', 'Cambios sin guardar')"
      data-cy="clinic-save-bar"
      class="absolute bottom-6 left-1/2 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-center gap-2.5 rounded-card bg-ink-900 py-3 pl-5 pr-3 text-surface-page shadow-popover"
    >
      <span class="flex-1 text-[14px] font-semibold">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <button type="button" data-cy="clinic-discard" class="h-11 rounded-ctl border border-surface-page/30 px-3.5 text-[14px] font-semibold" @click="discard">
        {{ t('Discard', 'Descartar') }}
      </button>
      <button type="button" data-cy="clinic-save" :disabled="saving" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-70" @click="save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
      </button>
    </div>

    <UiConfirmDialog
      v-if="archiveOpen && form"
      :title="t(`Archive ${form.name}?`, `¿Archivar ${form.name}?`)"
      :confirm-label="t('Archive', 'Archivar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="closing || upcomingCount > 0 || otherActiveCount === 0"
      @confirm="archive"
      @cancel="archiveOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('It leaves the clinic switcher, the calendar and online booking. Its appointments, patients and facturas are kept.', 'Deja de aparecer en el selector de clínica, el calendario y la reserva online. Sus citas, pacientes y facturas se conservan.') }}</p>
      <p v-if="upcomingCount > 0" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug text-warning-text" data-cy="clinic-archive-upcoming">
        <strong>{{ t(`It has ${upcomingCount} appointments from today on.`, `Tiene ${upcomingCount} citas a partir de hoy.`) }}</strong>
        {{ t('Move them to another location or cancel them before archiving, so no patient is left booked at a closed location.', 'Muévelas a otra sede o cancélalas antes de archivar, para que ningún paciente se quede con una cita en una sede cerrada.') }}
      </p>
      <p v-else-if="otherActiveCount === 0" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug text-warning-text">
        {{ t('It is your only active location. Add or reactivate another first.', 'Es tu única sede activa. Añade o reactiva otra antes.') }}
      </p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="deleteOpen && form"
      tone="danger"
      :title="t(`Delete ${form.name}?`, `¿Eliminar ${form.name}?`)"
      :confirm-label="t('Delete location', 'Eliminar sede')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :confirm-word="form.name"
      :busy="closing"
      @confirm="remove"
      @cancel="deleteOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('It has no appointments, so it can be removed entirely. Its calendar resources go with it. This cannot be undone.', 'No tiene citas, así que se puede eliminar del todo. Sus recursos de calendario se eliminan con ella. Esto no se puede deshacer.') }}</p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="leaveOpen"
      :title="t('Leave without saving?', '¿Salir sin guardar?')"
      :confirm-label="t('Leave without saving', 'Salir sin guardar')"
      :cancel-label="t('Keep editing', 'Seguir editando')"
      @confirm="leaveAnyway"
      @cancel="stayHere"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('The changes on this page have not been saved.', 'Los cambios de esta página no se han guardado.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
