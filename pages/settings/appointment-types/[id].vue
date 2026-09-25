<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { CALENDAR_PALETTE, isPaletteColor } from '~/utils/calendarPalette'
import { DURATION_MAX, DURATION_MIN, TYPE_STAGES, centsToInput, parseEurosToCents, parseMinutes, typeProblems } from '~/utils/appointmentTypes'

// One appointment type, everything about it on one page: what used to be the
// row of Settings -> Appointment Types (name, duration, price, colour, stage,
// the two online switches), its per-practitioner overrides (a disclosure under
// that row), and the deeper booking rules that lived on a separate tab of
// Online Booking -- who may book it, whether the patient picks a
// practitioner, how far ahead, the deposit. Three places for one object is how
// a clinic ends up with a deposit on a type it had turned off online.
//
// One Guardar for the page. The old table saved each cell on blur, silently,
// and ignored the error.

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { showToast } = useToast()
const typeId = route.params.id as string

// Durations are string | number: v-model on a number input returns a number
// once typed and the string it was given before.
interface OverrideForm { duration: string | number; price: string }
interface Form {
  name: string
  duration: string | number
  price: string
  color: string
  stage: string
  online: boolean
  bookableBy: string
  bypass: boolean
  maxDays: string | number
  payment: boolean
  deposit: string
  overrides: Record<string, OverrideForm>
}
interface Practitioner { id: string; full_name: string }
interface Usage { id: string; appointments: number; upcoming: number; waitlist: number; automations: string[]; receptionist: boolean }

const loaded = ref(false)
const missing = ref(false)
const form = ref<Form | null>(null)
const original = ref('')
const archivedAt = ref<string | null>(null)
const practitioners = ref<Practitioner[]>([])
const otherActive = ref<{ id: string; name: string }[]>([])
const accountMaxDays = ref(90)
const stripeConfigured = ref(false)
const usage = ref<Usage | null>(null)

function toForm(row: any, overrides: { team_member_id: string; duration_minutes: number | null; price_cents: number | null }[], people: Practitioner[]): Form {
  const byMember = Object.fromEntries(overrides.map((o) => [o.team_member_id, o]))
  return {
    name: row.name ?? '',
    duration: String(row.duration_minutes ?? 30),
    price: centsToInput(row.default_price_cents ?? 0),
    color: row.color ?? CALENDAR_PALETTE[0]!.hex,
    stage: row.stage ?? '',
    online: !!row.online_booking_enabled,
    bookableBy: row.online_bookable_by ?? 'all',
    bypass: !!row.online_bypass_practitioner,
    maxDays: row.online_max_days_ahead != null ? String(row.online_max_days_ahead) : '',
    payment: !!row.online_payment_required,
    deposit: centsToInput(row.online_deposit_cents),
    overrides: Object.fromEntries(
      people.map((p) => {
        const o = byMember[p.id]
        return [p.id, { duration: o?.duration_minutes != null ? String(o.duration_minutes) : '', price: centsToInput(o?.price_cents) }]
      }),
    ),
  }
}

async function load() {
  if (!store.accountId) await store.load()
  const [typeRes, peopleRes, ovrRes, othersRes, accountRes] = await Promise.all([
    supabase.from('appointment_types').select('*').eq('id', typeId).maybeSingle(),
    // Active practitioners only: an override for someone who has left or does
    // not treat would be a price nobody can be booked at.
    supabase.from('team_members').select('id, full_name').eq('is_practitioner', true).is('deleted_at', null).order('full_name'),
    supabase.from('appointment_type_overrides').select('team_member_id, duration_minutes, price_cents').eq('appointment_type_id', typeId),
    supabase.from('appointment_types').select('id, name').is('archived_at', null).neq('id', typeId),
    supabase.from('accounts').select('online_booking_max_days_ahead, stripe_publishable_key').eq('id', store.accountId!).maybeSingle(),
  ])
  const firstError = typeRes.error ?? peopleRes.error ?? ovrRes.error ?? othersRes.error
  if (firstError || !typeRes.data) {
    if (firstError) showToast(firstError.message, 'error')
    missing.value = true
    loaded.value = true
    return
  }
  practitioners.value = peopleRes.data ?? []
  otherActive.value = othersRes.data ?? []
  accountMaxDays.value = accountRes.data?.online_booking_max_days_ahead ?? 90
  // Payment requires Stripe to be set up for the account at all (Settings >
  // Payments) -- the same precondition card-on-file has, so the switch is
  // disabled rather than silently breaking checkout.
  stripeConfigured.value = !!accountRes.data?.stripe_publishable_key
  archivedAt.value = typeRes.data.archived_at
  form.value = toForm(typeRes.data, ovrRes.data ?? [], practitioners.value)
  original.value = JSON.stringify(form.value)
  loaded.value = true
  loadUsage()
}

async function loadUsage() {
  const { data, error } = await supabase.rpc('get_appointment_type_usage', { p_account_id: store.accountId! })
  if (error) {
    showToast(error.message, 'error')
    return
  }
  usage.value = ((data as Usage[] | null) ?? []).find((u) => u.id === typeId) ?? { id: typeId, appointments: 0, upcoming: 0, waitlist: 0, automations: [], receptionist: false }
}

onMounted(load)

const saved = computed(() => (original.value ? (JSON.parse(original.value) as Form) : null))
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)

// --- Validation -------------------------------------------------------------------
const problems = computed(() =>
  form.value
    ? typeProblems(
        { id: typeId, name: form.value.name, duration: form.value.duration, price: form.value.price, paymentRequired: form.value.online && form.value.payment, deposit: form.value.deposit, maxDaysAhead: form.value.maxDays },
        archivedAt.value ? [] : otherActive.value,
      )
    : {},
)
const overrideProblems = computed(() => {
  const out: Record<string, { duration?: boolean; price?: boolean }> = {}
  for (const [id, o] of Object.entries(form.value?.overrides ?? {})) {
    const d = parseMinutes(o.duration)
    const p = parseEurosToCents(o.price)
    const bad = {
      duration: d !== null && (Number.isNaN(d) || d < DURATION_MIN || d > DURATION_MAX),
      price: p !== null && (Number.isNaN(p) || p < 0),
    }
    if (bad.duration || bad.price) out[id] = bad
  }
  return out
})
const canSave = computed(() => Object.keys(problems.value).length === 0 && Object.keys(overrideProblems.value).length === 0)
const priceCents = computed(() => {
  const p = parseEurosToCents(form.value?.price ?? '')
  return p === null || Number.isNaN(p) ? 0 : p
})

// --- Save / discard -------------------------------------------------------------
const saving = ref(false)
const tried = ref(false)
const depositOverOpen = ref(false)

async function save() {
  if (!form.value || saving.value) return
  tried.value = true
  if (problems.value.deposit === 'deposit_over_price') {
    depositOverOpen.value = true
    return
  }
  if (!canSave.value) {
    showToast(t('Some fields need fixing before this can be saved.', 'Hay campos por corregir antes de guardar.'), 'error')
    return
  }
  saving.value = true
  const f = form.value
  const payment = f.online && f.payment
  const values = {
    name: f.name.trim(),
    duration_minutes: parseMinutes(f.duration)!,
    default_price_cents: priceCents.value,
    color: f.color,
    stage: f.stage || null,
    online_booking_enabled: f.online,
    online_bookable_by: f.bookableBy,
    online_bypass_practitioner: f.bypass,
    online_max_days_ahead: parseMinutes(f.maxDays),
    online_payment_required: f.payment,
    // A deposit only means something while payment is taken at booking; with
    // it off, a leftover amount above a since-lowered price would be refused
    // by the deposit check for a field nobody can see.
    online_deposit_cents: payment ? parseEurosToCents(f.deposit) : null,
  }
  const { error } = await supabase.from('appointment_types').update(values).eq('id', typeId).select('id').single()
  if (error) {
    saving.value = false
    showToast(
      error.code === '23505' ? t('There is already an active type with that name.', 'Ya hay un tipo activo con ese nombre.') : error.message,
      'error',
      8000,
    )
    return
  }

  // Overrides: only the rows that changed. Absence means "use the type's own
  // duration and price", so emptying both fields deletes the row rather than
  // storing two nulls.
  const before = saved.value?.overrides ?? {}
  const writes = Object.entries(f.overrides)
    .filter(([id, o]) => JSON.stringify(o) !== JSON.stringify(before[id] ?? { duration: '', price: '' }))
    .map(async ([memberId, o]) => {
      const duration = parseMinutes(o.duration)
      const price = parseEurosToCents(o.price)
      if (duration === null && price === null) {
        return supabase.from('appointment_type_overrides').delete().eq('appointment_type_id', typeId).eq('team_member_id', memberId)
      }
      return supabase
        .from('appointment_type_overrides')
        .upsert(
          { account_id: store.accountId!, appointment_type_id: typeId, team_member_id: memberId, duration_minutes: duration, price_cents: price },
          { onConflict: 'appointment_type_id,team_member_id' },
        )
    })
  const results = await Promise.all(writes)
  saving.value = false
  const overrideError = results.find((r) => r.error)?.error
  if (overrideError) {
    showToast(t(`The type was saved, but not every practitioner's price: ${overrideError.message}`, `El tipo se ha guardado, pero no todos los precios por profesional: ${overrideError.message}`), 'error', 8000)
    return
  }
  tried.value = false
  f.name = values.name
  if (!payment) f.deposit = ''
  original.value = JSON.stringify(f)
  showToast(t('Saved', 'Guardado'))
}
function discard() {
  form.value = JSON.parse(original.value)
  tried.value = false
}

// --- Leaving with unsaved changes -------------------------------------------------
const pendingLeave = ref<string | null>(null)
const leaveOpen = ref(false)
onBeforeRouteLeave((to) => {
  if (!dirty.value || pendingLeave.value === to.fullPath) return true
  pendingLeave.value = to.fullPath
  leaveOpen.value = true
  return false
})
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

// --- Archive / delete / reactivate -----------------------------------------------
const archiveOpen = ref(false)
const deleteOpen = ref(false)
const closing = ref(false)

function backToList(message: string) {
  showToast(message)
  pendingLeave.value = '/settings/appointment-types'
  router.push('/settings/appointment-types')
}

async function archive() {
  closing.value = true
  const { error } = await supabase.from('appointment_types').update({ archived_at: new Date().toISOString() }).eq('id', typeId).select('id').single()
  closing.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  archiveOpen.value = false
  backToList(t(`${saved.value?.name} archived.`, `${saved.value?.name} archivado.`))
}

async function remove() {
  closing.value = true
  const { error } = await supabase.from('appointment_types').delete().eq('id', typeId)
  closing.value = false
  if (error) {
    // guard_appointment_type_delete: an appointment arrived since the page loaded.
    showToast(error.message, 'error', 8000)
    deleteOpen.value = false
    loadUsage()
    return
  }
  deleteOpen.value = false
  backToList(t(`${saved.value?.name} deleted.`, `${saved.value?.name} eliminado.`))
}

async function reactivate() {
  const { error } = await supabase.from('appointment_types').update({ archived_at: null }).eq('id', typeId).select('id').single()
  if (error) {
    showToast(
      error.code === '23505'
        ? t('There is already an active type with this name. Rename this one, save, and reactivate it.', 'Ya hay un tipo activo con este nombre. Cámbiale el nombre a este, guarda y reactívalo.')
        : error.message,
      'error',
      8000,
    )
    return
  }
  archivedAt.value = null
  showToast(t('Offered again.', 'Vuelve a ofrecerse.'))
}

// --- Display ----------------------------------------------------------------------
const STAGES = computed(() => [{ value: '', label: t('No stage', 'Sin etapa') }, ...TYPE_STAGES.map((s) => ({ value: s.value, label: t(s.en, s.es) }))])
const WHO = computed(() => [
  { value: 'all', label: t('Everyone', 'Todos') },
  { value: 'new_patients', label: t('New patients only', 'Solo pacientes nuevos') },
  { value: 'existing_patients', label: t('Existing patients only', 'Solo pacientes actuales') },
])
const swatches = computed(() => {
  const list = CALENDAR_PALETTE.map((c) => ({ hex: c.hex, label: t(c.en, c.es) }))
  // A colour picked before the palette existed stays selectable, so opening
  // the page and saving something else does not repaint the type.
  const current = saved.value?.color
  if (current && !isPaletteColor(current)) list.unshift({ hex: current, label: t('Current colour', 'Color actual') })
  return list
})
function appointmentsText(n: number) {
  return n === 1 ? t('1 appointment', '1 cita') : t(`${n.toLocaleString('es-ES')} appointments`, `${n.toLocaleString('es-ES')} citas`)
}
const subtitle = computed(() => {
  const s = saved.value
  if (!s) return ''
  const price = parseEurosToCents(s.price) ?? 0
  return [`${s.duration} min`, formatEur(price), usage.value ? appointmentsText(usage.value.appointments) : null].filter(Boolean).join(' · ')
})
const SECTIONS = computed(() => [
  { id: 'basico', label: t('The type', 'El tipo de cita') },
  { id: 'online', label: t('Online booking', 'Reserva online') },
  { id: 'profesionales', label: t('Per practitioner', 'Por profesional') },
  { id: 'uso', label: t('Where it is used', 'Dónde se usa') },
  ...(archivedAt.value ? [] : [{ id: 'cerrar', label: t('Archive or delete', 'Archivar o eliminar') }]),
])
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'
}

const inputClass = 'h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const hint = 'text-[12.5px] font-normal leading-snug text-ink-muted'
const errorText = 'text-[12.5px] font-semibold text-danger-text'
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        <span aria-hidden="true">›</span>
        <NuxtLink to="/settings/appointment-types" class="font-semibold text-brand-text hover:underline" data-cy="type-back">{{ t('Appointment Types', 'Tipos de cita') }}</NuxtLink>
      </nav>
      <div v-if="saved" class="flex flex-wrap items-center gap-3">
        <span class="h-[18px] w-[18px] shrink-0 rounded-full" :style="{ background: saved.color }" aria-hidden="true" />
        <h1 class="text-[20px] font-bold text-ink-900" data-cy="type-title">{{ saved.name }}</h1>
        <span v-if="archivedAt" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12.5px] font-bold text-chip-text" data-cy="type-archived-chip">{{ t('Archived', 'Archivado') }}</span>
      </div>
      <span v-if="saved" class="text-[13px] text-ink-muted" data-cy="type-subtitle">{{ subtitle }}</span>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6 pb-32">
        <SettingsNav />
        <p v-if="loaded && missing" class="text-[14px] text-ink-muted" data-cy="type-missing">
          {{ t('This appointment type does not exist, or is not yours.', 'Este tipo de cita no existe o no es tuyo.') }}
          <NuxtLink to="/settings/appointment-types" class="text-brand-text hover:underline">{{ t('Back to appointment types', 'Volver a tipos de cita') }}</NuxtLink>
        </p>
        <template v-else-if="form">
          <nav :aria-label="t('Sections', 'Secciones')" class="sticky top-0 hidden w-[180px] shrink-0 flex-col gap-0.5 self-start 2xl:flex">
            <a v-for="s in SECTIONS" :key="s.id" :href="`#${s.id}`" class="flex min-h-10 items-center rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle">{{ s.label }}</a>
          </nav>

          <main class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-5" data-cy="type-page" :data-ready="loaded ? 'true' : undefined">
            <p v-if="archivedAt" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle px-4 py-3 text-[14px] text-ink-700" data-cy="type-archived-banner">
              <span class="flex-1">{{ t('Archived: not offered in the calendar, online booking or any picker. It stays on its appointments, in reports and in billing.', 'Archivado: no se ofrece en el calendario, la reserva online ni los selectores. Sigue en sus citas, en los informes y en los cobros.') }}</span>
              <button type="button" data-cy="type-page-reactivate" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="reactivate">
                {{ t('Reactivate', 'Reactivar') }}
              </button>
            </p>

            <!-- El tipo de cita -->
            <section id="basico" aria-labelledby="h-basico" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-basico" class="text-[16px] font-bold text-ink-900">{{ t('The appointment type', 'El tipo de cita') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('What the team sees in the calendar and the patient when booking.', 'Lo que ve el equipo en el calendario y el paciente al reservar.') }}</p>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input v-model="form.name" data-cy="type-name" type="text" :class="[inputClass, tried && problems.name ? 'border-danger-text' : 'border-line-control']" />
                <span v-if="tried && problems.name === 'name_missing'" :class="errorText" data-cy="type-error-name">{{ t('A type needs a name.', 'El tipo necesita un nombre.') }}</span>
                <span v-else-if="problems.name === 'name_taken'" :class="errorText" data-cy="type-error-name">{{ t('Another type already has this name.', 'Otro tipo ya tiene este nombre.') }}</span>
                <span v-else :class="hint">{{ t('It cannot repeat another type\'s name.', 'No puede repetirse con otro tipo.') }}</span>
              </label>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Duration', 'Duración') }}
                  <span class="flex items-center gap-2">
                    <input v-model="form.duration" data-cy="type-duration" type="number" :min="DURATION_MIN" :max="DURATION_MAX" step="5" inputmode="numeric" :class="[inputClass, 'w-[120px]', problems.duration ? 'border-danger-text' : 'border-line-control']" />
                    <span class="text-[14px] font-normal text-ink-500">{{ t('minutes', 'minutos') }}</span>
                  </span>
                  <span :class="problems.duration ? errorText : hint" :data-cy="problems.duration ? 'type-error-duration' : undefined">{{ t(`Between ${DURATION_MIN} and ${DURATION_MAX}.`, `Entre ${DURATION_MIN} y ${DURATION_MAX}.`) }}</span>
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Price', 'Precio') }}
                  <span class="flex items-center gap-2">
                    <input v-model="form.price" data-cy="type-price" type="text" inputmode="decimal" :class="[inputClass, 'w-[140px]', problems.price ? 'border-danger-text' : 'border-line-control']" />
                    <span class="text-[14px] font-normal text-ink-500">€</span>
                  </span>
                  <span v-if="problems.price" :class="errorText" data-cy="type-error-price">{{ t('Not an amount.', 'No es un importe.') }}</span>
                  <span v-else :class="hint">{{ t('What is charged when the appointment is closed. 0 if it is not charged.', 'Lo que se cobra al cerrar la cita. 0 si no se cobra.') }}</span>
                </label>
              </div>
              <div class="flex flex-col gap-2">
                <span id="color-label" class="text-[13px] font-semibold text-ink-700">{{ t('Colour in the calendar', 'Color en el calendario') }}</span>
                <div role="radiogroup" aria-labelledby="color-label" class="flex flex-wrap gap-2">
                  <button
                    v-for="c in swatches"
                    :key="c.hex"
                    type="button"
                    role="radio"
                    data-cy="type-color"
                    :data-color="c.hex"
                    :aria-checked="form.color.toLowerCase() === c.hex.toLowerCase()"
                    :aria-label="c.label"
                    :title="c.label"
                    class="h-11 w-11 rounded-ctl"
                    :class="form.color.toLowerCase() === c.hex.toLowerCase() ? 'border-[3px] border-ink-900' : 'border border-line'"
                    :style="{ background: c.hex }"
                    @click="form.color = c.hex"
                  />
                </div>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Treatment stage', 'Etapa del tratamiento') }}
                <select v-model="form.stage" data-cy="type-stage" :class="[inputClass, 'border-line-control']">
                  <option v-for="s in STAGES" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
                <span :class="hint">{{ t('For the Statistics report: first visit, first visit with offer, report, revision, maintenance, adjustment or other. Without a stage, these appointments are not counted there.', 'Para el informe de Estadísticas: primera visita, primera visita con oferta, informe, revisión, mantenimiento, ajuste u otra. Sin etapa, estas citas no cuentan ahí.') }}</span>
              </label>
            </section>

            <!-- Reserva online -->
            <section id="online" aria-labelledby="h-online" class="flex scroll-mt-4 flex-col gap-1 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1 pb-3">
                <h2 id="h-online" class="text-[16px] font-bold text-ink-900">{{ t('Online booking', 'Reserva online') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('How this type is booked from the booking page and the app.', 'Cómo se reserva este tipo desde la página de reservas y la app.') }}</p>
              </div>
              <SettingsSwitchRow
                v-model="form.online"
                data-cy="type-online"
                :title="t('Can be booked online', 'Se puede reservar online')"
                :description="t('It appears on the booking page and in the patient app.', 'Aparece en la página de reservas y en la app de pacientes.')"
              />
              <template v-if="form.online">
                <div class="flex flex-col gap-2 border-t border-line-row py-3">
                  <strong id="who-label" class="text-[14.5px] text-ink-900">{{ t('Who can book it', 'Quién puede reservarlo') }}</strong>
                  <div role="radiogroup" aria-labelledby="who-label" class="flex flex-col gap-1 rounded-ctl bg-chip-bg p-[3px] sm:flex-row">
                    <button
                      v-for="w in WHO"
                      :key="w.value"
                      type="button"
                      role="radio"
                      data-cy="type-bookable-by"
                      :data-value="w.value"
                      :aria-checked="form.bookableBy === w.value"
                      class="h-11 flex-1 rounded-[9px] px-2 text-[13.5px] font-semibold"
                      :class="form.bookableBy === w.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'"
                      @click="form.bookableBy = w.value"
                    >
                      {{ w.label }}
                    </button>
                  </div>
                  <span class="text-[13px] text-ink-500">{{ t('"New" means someone who has never had an appointment; it is checked by email and phone when booking.', '«Nuevos» son quienes nunca han tenido una cita; se comprueba por email y teléfono al reservar.') }}</span>
                </div>
                <SettingsSwitchRow
                  v-model="form.bypass"
                  data-cy="type-bypass"
                  :title="t('The patient does not choose a practitioner', 'El paciente no elige profesional')"
                  :description="t('The first one free is assigned. Useful for first visits.', 'Se le asigna el primero libre. Útil para primeras visitas.')"
                />
                <label class="flex flex-col gap-1.5 border-t border-line-row pb-1 pt-3 text-[13px] font-semibold text-ink-700">
                  {{ t('How far ahead it can be booked', 'Con cuánta antelación se puede reservar') }}
                  <span class="flex items-center gap-2">
                    <input v-model="form.maxDays" data-cy="type-max-days" type="number" min="1" inputmode="numeric" :placeholder="String(accountMaxDays)" :class="[inputClass, 'w-[120px]', problems.maxDays ? 'border-danger-text' : 'border-line-control']" />
                    <span class="text-[14px] font-normal text-ink-500">{{ t('days at most', 'días como máximo') }}</span>
                  </span>
                  <span v-if="problems.maxDays" :class="errorText">{{ t('A whole number of days, at least 1.', 'Un número entero de días, al menos 1.') }}</span>
                  <span v-else :class="hint" data-cy="type-max-days-hint">
                    {{ t(`Empty: the clinic's ${accountMaxDays} days`, `Vacío: los ${accountMaxDays} días de la clínica`) }}
                    (<NuxtLink to="/settings/online-booking" class="text-brand-text hover:underline">{{ t('Settings › Online booking', 'Ajustes › Reserva online') }}</NuxtLink>).
                  </span>
                </label>
                <SettingsSwitchRow
                  v-model="form.payment"
                  data-cy="type-payment"
                  :disabled="!stripeConfigured && !form.payment"
                  :title="t('Payment when booking', 'Pago al reservar')"
                >
                  <template v-if="stripeConfigured">{{ t('By card, through Stripe (connected). If the price is 0, nothing is charged.', 'Con tarjeta, por Stripe (conectado). Si el precio es 0, no se cobra nada.') }}</template>
                  <template v-else>
                    <span data-cy="type-payment-needs-stripe">{{ t('Needs Stripe, which is not set up yet:', 'Necesita Stripe, que aún no está configurado:') }}</span>
                    <NuxtLink to="/settings/payments" class="font-semibold text-brand-text hover:underline">{{ t('Settings › Payments', 'Ajustes › Pagos') }}</NuxtLink>.
                  </template>
                </SettingsSwitchRow>
                <label v-if="form.payment" class="flex flex-col gap-1.5 pb-1 text-[13px] font-semibold text-ink-700">
                  {{ t('Deposit', 'Señal') }}
                  <span class="flex items-center gap-2">
                    <input v-model="form.deposit" data-cy="type-deposit" type="text" inputmode="decimal" :class="[inputClass, 'w-[140px]', problems.deposit ? 'border-danger-text' : 'border-line-control']" />
                    <span class="text-[14px] font-normal text-ink-500">{{ t('€ when booking', '€ al reservar') }}</span>
                  </span>
                  <span v-if="problems.deposit === 'deposit_over_price'" :class="errorText" data-cy="type-error-deposit">{{ t(`It cannot be more than the price (${formatEur(priceCents)}).`, `No puede ser mayor que el precio (${formatEur(priceCents)}).`) }}</span>
                  <span v-else-if="problems.deposit" :class="errorText" data-cy="type-error-deposit">{{ t('Not an amount.', 'No es un importe.') }}</span>
                  <span v-else :class="hint">{{ t(`Empty: the full price is charged (${formatEur(priceCents)}). It cannot be more than the price. The rest is charged at the clinic.`, `Vacío: se cobra el precio completo (${formatEur(priceCents)}). No puede ser mayor que el precio. El resto se cobra en la clínica.`) }}</span>
                </label>
              </template>
            </section>

            <!-- Por profesional -->
            <section id="profesionales" aria-labelledby="h-profesionales" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-profesionales" class="text-[16px] font-bold text-ink-900">{{ t('Per practitioner', 'Por profesional') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('If someone takes longer or charges differently. Empty: the duration and price above are used.', 'Si alguien tarda o cobra distinto. Vacío: usa la duración y el precio de arriba.') }}</p>
              </div>
              <p v-if="practitioners.length === 0" class="text-[14px] text-ink-muted">{{ t('There are no active practitioners yet.', 'Todavía no hay profesionales activos.') }}</p>
              <div v-else class="overflow-hidden rounded-ctl border border-line">
                <div class="hidden grid-cols-[1.6fr_1fr_1fr_60px] items-center bg-surface-subtle text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted sm:grid">
                  <span class="px-3.5 py-2.5">{{ t('Practitioner', 'Profesional') }}</span>
                  <span class="px-3.5 py-2.5">{{ t('Duration (min)', 'Duración (min)') }}</span>
                  <span class="px-3.5 py-2.5">{{ t('Price (€)', 'Precio (€)') }}</span>
                  <span />
                </div>
                <div
                  v-for="p in practitioners"
                  :key="p.id"
                  data-cy="type-override-row"
                  :data-member-id="p.id"
                  class="grid grid-cols-[1fr_1fr_52px] items-center gap-x-2 border-t border-line-row px-2 py-2 first:border-t-0 sm:grid-cols-[1.6fr_1fr_1fr_60px] sm:gap-x-0 sm:px-0 sm:first:border-t"
                >
                  <span class="col-span-3 flex items-center gap-2.5 px-1.5 pb-1.5 text-[14px] font-semibold text-ink-900 sm:col-span-1 sm:px-3.5 sm:pb-0">
                    <span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text" aria-hidden="true">{{ initials(p.full_name) }}</span>
                    {{ p.full_name }}
                  </span>
                  <span class="sm:px-3.5">
                    <input
                      v-model="form.overrides[p.id]!.duration"
                      data-cy="type-override-duration"
                      type="number"
                      inputmode="numeric"
                      :min="DURATION_MIN"
                      :max="DURATION_MAX"
                      :placeholder="String(form.duration)"
                      :aria-label="t(`Duration for ${p.full_name}`, `Duración de ${p.full_name}`)"
                      :class="[inputClass, 'w-full', overrideProblems[p.id]?.duration ? 'border-danger-text' : 'border-line-control']"
                    />
                  </span>
                  <span class="sm:px-3.5">
                    <input
                      v-model="form.overrides[p.id]!.price"
                      data-cy="type-override-price"
                      type="text"
                      inputmode="decimal"
                      :placeholder="form.price"
                      :aria-label="t(`Price for ${p.full_name}`, `Precio de ${p.full_name}`)"
                      :class="[inputClass, 'w-full', overrideProblems[p.id]?.price ? 'border-danger-text' : 'border-line-control']"
                    />
                  </span>
                  <span class="flex justify-center">
                    <button
                      v-if="form.overrides[p.id]!.duration || form.overrides[p.id]!.price"
                      type="button"
                      data-cy="type-override-clear"
                      :aria-label="t(`Remove ${p.full_name}'s own price`, `Quitar el precio propio de ${p.full_name}`)"
                      class="flex h-11 w-11 items-center justify-center rounded-ctl text-[20px] text-ink-muted hover:bg-surface-subtle"
                      @click="form.overrides[p.id] = { duration: '', price: '' }"
                    >
                      ×
                    </button>
                  </span>
                </div>
              </div>
              <p v-if="Object.keys(overrideProblems).length > 0" :class="errorText" data-cy="type-error-overrides">{{ t(`Durations between ${DURATION_MIN} and ${DURATION_MAX} minutes, prices of 0 or more.`, `Duraciones entre ${DURATION_MIN} y ${DURATION_MAX} minutos, precios de 0 o más.`) }}</p>
              <p :class="hint">{{ t('Only active practitioners appear. Used by the calendar, online booking, the patient app and the API.', 'Solo aparecen profesionales activos. Lo usan el calendario, la reserva online, la app de pacientes y la API.') }}</p>
            </section>

            <!-- Dónde se usa -->
            <section id="uso" aria-labelledby="h-uso" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-uso" class="text-[16px] font-bold text-ink-900">{{ t('Where it is used', 'Dónde se usa') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('Before changing or archiving it.', 'Antes de cambiarlo o archivarlo.') }}</p>
              </div>
              <div v-if="!usage" class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <UiSkeleton v-for="i in 4" :key="i" class="h-16 rounded-ctl" />
              </div>
              <div v-else class="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-cy="type-usage">
                <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] text-ink-700" data-cy="type-usage-appointments">
                  <strong>{{ appointmentsText(usage.appointments) }}</strong>
                  <span class="text-ink-500">{{ t(`${usage.upcoming} of them from today on`, `${usage.upcoming} de ellas a partir de hoy`) }}</span>
                </div>
                <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] text-ink-700" data-cy="type-usage-waitlist">
                  <strong>{{ t(`${usage.waitlist} on the waitlist`, `${usage.waitlist} en la lista de espera`) }}</strong>
                  <span class="text-ink-500">{{ t('waiting for a slot of this type', 'esperan un hueco de este tipo') }}</span>
                </div>
                <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] text-ink-700" data-cy="type-usage-automations">
                  <strong>{{ usage.automations.length === 1 ? t('1 automation', '1 automatización') : t(`${usage.automations.length} automations`, `${usage.automations.length} automatizaciones`) }}</strong>
                  <span class="text-ink-500">
                    <template v-if="usage.automations.length > 0">{{ usage.automations.map((n) => `«${n}»`).join(', ') }} {{ usage.automations.length === 1 ? t('filters by this type', 'filtra por este tipo') : t('filter by this type', 'filtran por este tipo') }}</template>
                    <template v-else>{{ t('none filters by this type', 'ninguna filtra por este tipo') }}</template>
                  </span>
                </div>
                <div class="flex flex-col gap-0.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] text-ink-700" data-cy="type-usage-receptionist">
                  <strong>{{ t('AI receptionist', 'Recepcionista IA') }}</strong>
                  <span class="text-ink-500">{{ usage.receptionist ? t('may offer it when booking', 'puede ofrecerlo al reservar') : t('does not offer it', 'no lo ofrece') }}</span>
                </div>
              </div>
            </section>

            <!-- Archivar o eliminar -->
            <section v-if="!archivedAt" id="cerrar" aria-labelledby="h-cerrar" class="flex scroll-mt-4 flex-col gap-3 rounded-card border border-line bg-surface p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-cerrar" class="text-[16px] font-bold text-ink-900">{{ t('Archive or delete', 'Archivar o eliminar') }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t('Archiving loses none of its history.', 'Nada de su historial se pierde al archivar.') }}</p>
              </div>
              <p v-if="dirty" class="text-[13px] text-ink-500">{{ t('Save or discard your changes first.', 'Guarda o descarta los cambios antes.') }}</p>
              <div class="flex flex-wrap items-center gap-4 rounded-ctl border border-line px-4 py-3.5">
                <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Archive', 'Archivar') }}</strong>
                  <span class="text-[13px] leading-snug text-ink-500">{{ t(`No longer offered in the calendar, online booking or the pickers. It stays on its ${usage?.appointments ?? 0} appointments, in reports and in billing, and can be reactivated.`, `Deja de ofrecerse en el calendario, la reserva online y los selectores. Sigue en sus ${usage?.appointments ?? 0} citas, en los informes y en los cobros, y se puede reactivar.`) }}</span>
                </div>
                <button type="button" data-cy="type-archive" :disabled="dirty || !usage" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-ink-faint" @click="archiveOpen = true">
                  {{ t('Archive…', 'Archivar…') }}
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-4 rounded-ctl border border-line px-4 py-3.5">
                <div class="flex min-w-[240px] flex-1 flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Delete', 'Eliminar') }}</strong>
                  <span v-if="(usage?.appointments ?? 0) > 0" class="text-[13px] leading-snug text-ink-500" data-cy="type-delete-unavailable">
                    {{ t(`Not available: ${appointmentsText(usage!.appointments)} use it. Only a type no appointment has ever used can be deleted.`, `No disponible: ${appointmentsText(usage!.appointments)} lo usan. Solo se puede eliminar un tipo que ninguna cita haya usado.`) }}
                  </span>
                  <span v-else class="text-[13px] leading-snug text-ink-500">{{ t('No appointment has used it, so it can be removed entirely.', 'Ninguna cita lo ha usado, así que se puede eliminar del todo.') }}</span>
                </div>
                <button
                  type="button"
                  data-cy="type-delete"
                  :disabled="dirty || !usage || usage.appointments > 0"
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
      data-cy="type-save-bar"
      class="absolute bottom-6 left-1/2 flex w-[min(820px,calc(100%-32px))] -translate-x-1/2 items-center gap-2.5 rounded-card bg-ink-900 py-3 pl-5 pr-3 text-surface-page shadow-popover"
    >
      <span class="flex-1 text-[14px] font-semibold">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <button type="button" data-cy="type-discard" class="h-11 rounded-ctl border border-surface-page/30 px-3.5 text-[14px] font-semibold" @click="discard">
        {{ t('Discard', 'Descartar') }}
      </button>
      <button type="button" data-cy="type-save" :disabled="saving" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-70" @click="save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
      </button>
    </div>

    <UiConfirmDialog
      v-if="archiveOpen && saved"
      :title="t(`Archive «${saved.name}»?`, `¿Archivar «${saved.name}»?`)"
      :confirm-label="t('Archive', 'Archivar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="closing"
      @confirm="archive"
      @cancel="archiveOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">
        {{ t(`No longer offered in the calendar, online booking or the pickers. Its ${usage?.appointments ?? 0} appointments keep it and still count in reports.`, `Deja de ofrecerse en el calendario, la reserva online y los selectores. Sus ${usage?.appointments ?? 0} citas lo conservan y siguen contando en los informes.`) }}
      </p>
      <p v-if="usage && (usage.upcoming > 0 || usage.waitlist > 0 || usage.automations.length > 0 || usage.receptionist)" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug text-warning-text" data-cy="type-archive-in-use">
        <strong>{{ t('Still in use:', 'Sigue en uso:') }}</strong>
        {{
          [
            usage.upcoming > 0 ? t(`${usage.upcoming} appointments from today on (they are kept)`, `${usage.upcoming} citas a partir de hoy (se mantienen)`) : null,
            usage.waitlist > 0 ? t(`${usage.waitlist} on the waitlist`, `${usage.waitlist} en lista de espera`) : null,
            usage.automations.length > 0 ? t(`${usage.automations.length} automations that filter by this type and will stop firing for new appointments`, `${usage.automations.length} automatizaciones que filtran por este tipo y dejarán de dispararse para citas nuevas`) : null,
            usage.receptionist ? t('the AI receptionist will stop offering it', 'la recepcionista IA dejará de ofrecerlo') : null,
          ]
            .filter(Boolean)
            .join(', ')
        }}.
      </p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="deleteOpen && saved"
      tone="danger"
      :title="t(`Delete «${saved.name}»?`, `¿Eliminar «${saved.name}»?`)"
      :confirm-label="t('Delete type', 'Eliminar tipo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :confirm-word="saved.name"
      :busy="closing"
      @confirm="remove"
      @cancel="deleteOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('No appointment has used it, so it can be removed entirely, with its per-practitioner prices. This cannot be undone.', 'Ninguna cita lo ha usado, así que se puede eliminar del todo, con sus precios por profesional. Esto no se puede deshacer.') }}</p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="depositOverOpen"
      :title="t('The deposit is more than the price', 'La señal es mayor que el precio')"
      :confirm-label="t('Fix it', 'Corregir')"
      :cancel-label="t('Close', 'Cerrar')"
      @confirm="depositOverOpen = false"
      @cancel="depositOverOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500" data-cy="type-deposit-over">
        {{ t(`The deposit (${formatEur(parseEurosToCents(form?.deposit ?? '') ?? 0)}) cannot be more than the price (${formatEur(priceCents)}). Lower it, or leave it empty to charge the full price when booking.`, `La señal (${formatEur(parseEurosToCents(form?.deposit ?? '') ?? 0)}) no puede superar el precio (${formatEur(priceCents)}). Bájala, o déjala vacía para cobrar el precio completo al reservar.`) }}
      </p>
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
