<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { hasBusinessHoursConfigured } from '~/utils/businessHours'
import { CALENDAR_PALETTE, isPaletteColor } from '~/utils/calendarPalette'
import { formatLongDate, formatShortDate, formatTime } from '~/utils/billing'

// "Mi cuenta": the signed-in person's own page. Design: the "QuiroFlow Mi
// Cuenta" canvas. Four sections in the order they are reached for --
//
//   Tú           photo, name, login email (read-only), role and clinics
//   Tu agenda    practitioners only: calendar colour, their hours, whether
//                patients can book them online
//   Idioma       applies at once
//   Seguridad    password, two-factor, signing out other devices
//
// -- and, set apart below them, removing your own access.
//
// One save rule per kind of thing, stated where it applies: name and colour
// wait for Guardar (a bar appears only once something has changed), the
// language applies at once, the password has its own small form, and the two
// consequential actions ask in an in-app dialog rather than window.confirm().
//
// The theme is not here: the switch beside the account menu in the top bar
// sets it (and saves it -- see AppThemeToggle).

const supabase = useSupabaseClient()
const authPasswordError = useAuthPasswordError()
const user = useSupabaseUser()
const store = useAccountStore()
const { preference: langPreference, setPreference: setLangPreference } = useLang()
const t = useT()
const { showToast } = useToast()
const twoFactor = useTwoFactor()

// --- What the store does not carry, loaded for this page -----------------------
interface Me {
  is_practitioner: boolean
  online_booking_enabled: boolean
  business_hours: BusinessHours | null
  role_id: string | null
}
const me = ref<Me | null>(null)
const roleName = ref<string | null>(null)
const myClinicIds = ref<string[]>([])
const ownerCount = ref<number | null>(null)
const twoFactorSince = ref<string | null>(null)
const twoFactorEnabled = ref<boolean | null>(null)

async function loadMe() {
  const tm = store.teamMember
  if (!tm) return
  const [{ data: row }, { data: memberClinics }, owners] = await Promise.all([
    supabase.from('team_members').select('is_practitioner, online_booking_enabled, business_hours, role_id').eq('id', tm.id).maybeSingle(),
    supabase.from('team_member_clinics').select('clinic_id').eq('team_member_id', tm.id),
    tm.is_owner
      ? supabase.from('team_members').select('id', { count: 'exact', head: true }).eq('account_id', tm.account_id).eq('is_owner', true).is('deleted_at', null)
      : Promise.resolve({ count: null }),
  ])
  me.value = row ? { ...row, business_hours: (row.business_hours as BusinessHours | null) ?? null } : null
  myClinicIds.value = (memberClinics ?? []).map((c) => c.clinic_id)
  ownerCount.value = owners.count ?? null
  if (row?.role_id) {
    const { data: role } = await supabase.from('account_roles').select('name').eq('id', row.role_id).maybeSingle()
    roleName.value = role?.name ?? null
  }
}

// Set once the page has mounted and loaded what it shows: until then the
// server-rendered markup is on screen but not yet interactive.
const ready = ref(false)
// useSupabaseUser() gives the session's token claims, which carry the email
// but not last_sign_in_at -- that comes from the auth user itself.
const lastSignInAt = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([
    loadMe(),
    twoFactor.isEnabled().then((on) => (twoFactorEnabled.value = on)),
    twoFactor.enabledSince().then((at) => (twoFactorSince.value = at)),
    supabase.auth.getUser().then(({ data }) => (lastSignInAt.value = data.user?.last_sign_in_at ?? null)),
  ])
  ready.value = true
})
watch(
  () => store.teamMember?.id,
  (id, prev) => {
    if (id && id !== prev) loadMe()
  },
)

const isPractitioner = computed(() => !!me.value?.is_practitioner)

// Custom roles have their own names; the three built-in ones read as the
// account menu reads them.
const roleLabel = computed(() => {
  if (roleName.value) return roleName.value
  const tm = store.teamMember
  if (tm?.is_owner) return t('Owner', 'Propietario')
  if (tm?.role === 'front_desk') return t('Front Desk', 'Recepción')
  return t('Practitioner', 'Profesional')
})
// Clinics this person is assigned to. Nobody assigned to a specific clinic
// works across all of them, which is what the calendar assumes too.
const clinicNames = computed(() => {
  const mine = store.clinics.filter((c) => myClinicIds.value.includes(c.id))
  return (mine.length ? mine : store.clinics).map((c) => c.name)
})

// --- Tú + Tu agenda: edited together, saved together -------------------------
const fullName = ref('')
const color = ref('')
const savedName = ref('')
const savedColor = ref('')
watch(
  () => store.teamMember,
  (tm) => {
    if (!tm) return
    fullName.value = savedName.value = tm.full_name
    color.value = savedColor.value = tm.color
  },
  { immediate: true },
)
const dirty = computed(() => fullName.value.trim() !== savedName.value || color.value !== savedColor.value)
const savingProfile = ref(false)

async function saveProfile() {
  if (!store.teamMember || !dirty.value) return
  const name = fullName.value.trim()
  if (!name) {
    showToast(t('Your name cannot be empty.', 'Tu nombre no puede quedar vacío.'), 'error')
    return
  }
  savingProfile.value = true
  const { error } = await supabase.from('team_members').update({ full_name: name, color: color.value }).eq('id', store.teamMember.id)
  savingProfile.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  store.teamMember.full_name = name
  store.teamMember.color = color.value
  savedName.value = name
  savedColor.value = color.value
  fullName.value = name
  showToast(t('Saved', 'Guardado'))
}
function discardProfile() {
  fullName.value = savedName.value
  color.value = savedColor.value
}

const initials = computed(
  () =>
    fullName.value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?',
)
const firstName = computed(() => fullName.value.trim().split(/\s+/)[0] ?? '')
// A colour chosen before the palette existed is kept, and shown as its own
// selected swatch, rather than silently swapped for the nearest palette one.
const customColor = computed(() => (savedColor.value && !isPaletteColor(savedColor.value) ? savedColor.value : null))
const swatches = computed(() => [
  ...CALENDAR_PALETTE.map((c) => ({ hex: c.hex, label: t(c.en, c.es) })),
  ...(customColor.value ? [{ hex: customColor.value, label: t('Custom', 'Personalizado') }] : []),
])
function isChosen(hex: string) {
  return color.value.toLowerCase() === hex.toLowerCase()
}

// Working hours: this person's own when an owner has set them; otherwise they
// follow the clinic's, as the calendar does (practitionerWindowsForDay).
const WEEK: { key: string; en: string; es: string }[] = [
  { key: 'mon', en: 'Monday', es: 'Lunes' },
  { key: 'tue', en: 'Tuesday', es: 'Martes' },
  { key: 'wed', en: 'Wednesday', es: 'Miércoles' },
  { key: 'thu', en: 'Thursday', es: 'Jueves' },
  { key: 'fri', en: 'Friday', es: 'Viernes' },
  { key: 'sat', en: 'Saturday', es: 'Sábado' },
  { key: 'sun', en: 'Sunday', es: 'Domingo' },
]
const ownHours = computed(() => hasBusinessHoursConfigured(me.value?.business_hours))
const hoursSource = computed<BusinessHours | null>(() => (ownHours.value ? (me.value?.business_hours ?? null) : (store.currentClinic?.business_hours ?? null)))
const weekRows = computed(() =>
  WEEK.map((d) => {
    const windows = hoursSource.value?.[d.key] ?? []
    return {
      key: d.key,
      day: t(d.en, d.es),
      // One entry per shift, so a split day wraps between shifts on a phone,
      // never through the middle of "16:00–21:00".
      ranges: windows.map(([a, b]) => `${a}–${b}`),
    }
  }),
)
const anyHours = computed(() => hasBusinessHoursConfigured(hoursSource.value))

// --- Idioma: applies at once ------------------------------------------------
const LANGUAGES = [
  { value: 'es' as const, label: 'Español' },
  { value: 'en' as const, label: 'English' },
]
const savingLang = ref(false)
async function chooseLanguage(value: 'en' | 'es') {
  if (!store.teamMember || langPreference.value === value) return
  setLangPreference(value)
  savingLang.value = true
  await supabase.from('team_members').update({ language_preference: value }).eq('id', store.teamMember.id)
  store.teamMember.language_preference = value
  savingLang.value = false
}

// --- Seguridad --------------------------------------------------------------
const lastSignIn = computed(() => {
  const at = lastSignInAt.value
  if (!at) return null
  const d = new Date(at)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? t(`today at ${formatTime(d)}`, `hoy a las ${formatTime(d)}`) : t(`${formatShortDate(d)} at ${formatTime(d)}`, `${formatShortDate(d)} a las ${formatTime(d)}`)
})

const passwordOpen = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const savingPassword = ref(false)
const passwordsMatch = computed(() => newPassword.value.length > 0 && newPassword.value === confirmPassword.value)
function closePassword() {
  passwordOpen.value = false
  newPassword.value = ''
  confirmPassword.value = ''
}
async function changePassword() {
  if (newPassword.value.length < 8) {
    showToast(t('Password must be at least 8 characters.', 'La contraseña debe tener al menos 8 caracteres.'), 'error')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    showToast(t('Passwords do not match.', 'Las contraseñas no coinciden.'), 'error')
    return
  }
  savingPassword.value = true
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  savingPassword.value = false
  if (error) {
    showToast(authPasswordError(error), 'error')
    return
  }
  closePassword()
  showToast(t('Password updated.', 'Contraseña actualizada.'))
}

// Two-factor. Each person sets it up on their own login; a clinic can also
// require it of everyone (Settings > Team), in which case it stays on here.
const settingUpTwoFactor = ref(false)
const confirmingTwoFactorOff = ref(false)
const removingTwoFactor = ref(false)
async function onTwoFactorEnabled() {
  settingUpTwoFactor.value = false
  twoFactorEnabled.value = true
  twoFactorSince.value = await twoFactor.enabledSince()
  showToast(t('Two-factor authentication is on.', 'La verificación en dos pasos está activada.'))
}
async function removeTwoFactor() {
  removingTwoFactor.value = true
  const failure = await twoFactor.remove()
  removingTwoFactor.value = false
  confirmingTwoFactorOff.value = false
  if (failure) {
    showToast(failure, 'error')
    return
  }
  twoFactorEnabled.value = false
  twoFactorSince.value = null
  showToast(t('Two-factor authentication is off.', 'La verificación en dos pasos está desactivada.'))
}

// "Left it signed in on the front-desk iPad": every session but this one.
const signingOutOthers = ref(false)
const signedOutOthers = ref(false)
async function signOutOthers() {
  signingOutOthers.value = true
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  signingOutOthers.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  signedOutOthers.value = true
  showToast(t('Signed out of your other devices.', 'Sesión cerrada en tus otros dispositivos.'))
}

// --- Removing your own access ---------------------------------------------------
// The server refuses the last owner (/api/account/delete). The page knows that
// before the click, so it says so instead of failing after a confirmation.
const soleOwner = computed(() => !!store.teamMember?.is_owner && ownerCount.value !== null && ownerCount.value <= 1)
const confirmingDelete = ref(false)
const deletingAccount = ref(false)
async function deleteAccount() {
  deletingAccount.value = true
  try {
    await $fetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    confirmingDelete.value = false
    showToast(err?.data?.statusMessage ?? t('Could not remove your access.', 'No se pudo eliminar tu acceso.'), 'error')
    return
  }
  await supabase.auth.signOut()
  await navigateTo('/login')
}

const sections = computed(() => [
  { id: 'tu', label: t('You', 'Tú') },
  ...(isPractitioner.value ? [{ id: 'agenda', label: t('Your schedule', 'Tu agenda') }] : []),
  { id: 'idioma', label: t('Language', 'Idioma') },
  { id: 'seguridad', label: t('Security', 'Seguridad') },
  { id: 'acceso', label: t('Remove my access', 'Eliminar mi acceso') },
])
const phoneSections = computed(() => sections.value.filter((s) => s.id !== 'acceso'))
</script>

<template>
  <div class="flex h-full flex-col" data-cy="account-page" :data-ready="ready ? 'true' : 'false'">
    <PageHeader :title="t('My account', 'Mi cuenta')" />
    <div class="flex-1 overflow-y-auto bg-surface-page">
      <div class="mx-auto flex max-w-[1000px] gap-10 px-4 pb-32 pt-5 sm:px-6 lg:pt-8">
        <!-- Section index: a column of anchors on a wide screen -->
        <nav :aria-label="t('Sections', 'Secciones')" class="sticky top-8 hidden h-fit w-[200px] shrink-0 flex-col gap-0.5 lg:flex">
          <a
            v-for="s in sections"
            :key="s.id"
            :href="`#${s.id}`"
            class="flex min-h-10 items-center rounded-ctl px-3 text-[14px] font-semibold hover:bg-surface-subtle"
            :class="s.id === 'acceso' ? 'text-danger-text' : 'text-ink-500'"
          >
            {{ s.label }}
          </a>
        </nav>

        <main class="flex min-w-0 max-w-[720px] flex-1 flex-col gap-4 lg:gap-6">
          <p class="text-[13px] text-ink-muted">{{ t('Your details, your preferences and your access. They only affect you.', 'Tus datos, tus preferencias y tu acceso. Solo te afectan a ti.') }}</p>

          <!-- On a phone: the same anchors as chips -->
          <nav :aria-label="t('Sections', 'Secciones')" class="-mx-4 flex gap-1.5 overflow-x-auto px-4 lg:hidden">
            <a v-for="s in phoneSections" :key="s.id" :href="`#${s.id}`" class="flex h-9 shrink-0 items-center rounded-full border border-line-control px-3 text-[13px] font-semibold text-ink-700">
              {{ s.label }}
            </a>
          </nav>

          <!-- 1. Tú -->
          <section id="tu" aria-labelledby="h-tu" data-cy="account-you" class="flex scroll-mt-6 flex-col gap-5 rounded-card border border-line bg-surface p-4 sm:p-6">
            <div>
              <h2 id="h-tu" class="text-[16px] font-bold text-ink-900">{{ t('You', 'Tú') }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('How the rest of the team sees you, and patients if they book with you.', 'Cómo te ve el resto del equipo, y los pacientes si reservan contigo.') }}</p>
            </div>
            <div v-if="store.teamMember" class="flex items-center gap-4">
              <SettingsTeamMemberPhotoUpload
                :account-id="store.accountId!"
                :team-member-id="store.teamMember.id"
                :photo-storage-path="store.teamMember.photo_storage_path"
                :initials="initials"
                :color="color"
                :size="72"
                @uploaded="store.load()"
                @failed="(m) => showToast(t(`Could not change your photo: ${m}`, `No se pudo cambiar tu foto: ${m}`), 'error', 8000)"
              />
              <p class="text-[12.5px] text-ink-muted">{{ t('Tap your photo to change it. It shows in the sidebar and, if you see patients, on online booking.', 'Toca tu foto para cambiarla. Sale en la barra lateral y, si atiendes citas, en la reserva online.') }}</p>
            </div>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
              {{ t('Full name', 'Nombre completo') }}
              <input
                v-model="fullName"
                data-cy="account-name"
                type="text"
                autocomplete="name"
                class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </label>
            <div class="flex flex-col gap-1.5">
              <span class="text-[13px] font-semibold text-ink-700">{{ t('Login email', 'Correo de acceso') }}</span>
              <div class="flex min-h-9 touch:min-h-11 items-center gap-2.5 rounded-ctl border border-line bg-surface-subtle px-3" data-cy="account-email">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                <span class="min-w-0 break-all text-[15px] text-ink-900">{{ user?.email }}</span>
              </div>
              <span class="text-[12px] text-ink-muted">
                {{ t("It's what you sign in with, so it isn't changed here. To change it, write to", 'Es tu usuario para entrar, así que no se cambia desde aquí. Para cambiarlo, escribe a') }}
                <a href="mailto:hola@quiroflow.com" class="font-medium text-brand-text underline">hola@quiroflow.com</a>.
              </span>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Role', 'Rol') }}</span>
                <span data-cy="account-role" class="self-start rounded-full border border-brand-tintBorder bg-brand-tint px-2.5 py-1 text-[13px] font-semibold text-brand-text">{{ roleLabel }}</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-[13px] font-semibold text-ink-700">{{ clinicNames.length === 1 ? t('Clinic', 'Clínica') : t('Clinics', 'Clínicas') }}</span>
                <span class="flex flex-wrap gap-1.5" data-cy="account-clinics">
                  <span v-for="c in clinicNames" :key="c" class="rounded-full border border-chip-border bg-chip-bg px-2.5 py-1 text-[13px] text-ink-700">{{ c }}</span>
                </span>
              </div>
            </div>
            <p class="-mt-2 text-[12px] text-ink-muted">{{ t('An owner assigns your role and clinics, in Settings › Team.', 'Tu rol y tus clínicas los asigna una persona propietaria en Ajustes › Equipo.') }}</p>
          </section>

          <!-- 2. Tu agenda: practitioners only -->
          <section v-if="isPractitioner" id="agenda" aria-labelledby="h-agenda" data-cy="account-schedule" class="flex scroll-mt-6 flex-col gap-5 rounded-card border border-line bg-surface p-4 sm:p-6">
            <div>
              <h2 id="h-agenda" class="text-[16px] font-bold text-ink-900">{{ t('Your schedule', 'Tu agenda') }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('How you show on the calendar, and when you can be booked.', 'Cómo apareces en el calendario y cuándo se te puede reservar.') }}</p>
            </div>

            <fieldset class="flex flex-col gap-3">
              <legend class="mb-2 text-[13px] font-semibold text-ink-700">{{ t('Your colour on the calendar', 'Tu color en el calendario') }}</legend>
              <div class="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div role="radiogroup" :aria-label="t('Colour', 'Color')" class="grid grid-cols-5 gap-1.5 self-start" data-cy="account-palette">
                  <button
                    v-for="s in swatches"
                    :key="s.hex"
                    type="button"
                    role="radio"
                    :aria-checked="isChosen(s.hex)"
                    :aria-label="s.label"
                    :title="s.label"
                    :data-color="s.hex"
                    class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-ctl bg-surface"
                    :class="isChosen(s.hex) ? 'border-2 border-ink-900' : 'border border-line-control hover:border-line-controlHover'"
                    @click="color = s.hex"
                  >
                    <span class="h-6 w-6 rounded-full" :style="{ background: s.hex }" />
                  </button>
                </div>
                <div class="flex flex-1 flex-col gap-1.5" aria-hidden="true">
                  <span class="text-[12px] text-ink-muted">{{ t('How it looks on the calendar', 'Así se ve en el calendario') }}</span>
                  <span class="flex h-8 items-center gap-1.5 self-start rounded-full border border-line-control pl-2 pr-3 text-[13px] font-semibold text-ink-900">
                    <span class="h-2.5 w-2.5 rounded-full" :style="{ background: color }" />{{ firstName }}
                  </span>
                  <span
                    class="flex flex-col gap-0.5 rounded-ctlSm px-2.5 py-2"
                    :style="{ background: `color-mix(in srgb, ${color} 16%, rgb(var(--color-surface)))`, border: `1px solid color-mix(in srgb, ${color} 50%, rgb(var(--color-surface)))` }"
                  >
                    <strong class="text-[13px] text-ink-900">{{ t('Your next patient', 'Tu próximo paciente') }}</strong>
                    <span class="text-[12px] text-ink-muted">18:00 · {{ firstName }}</span>
                  </span>
                </div>
              </div>
              <span class="text-[12px] text-ink-muted">{{ t('No red: on the calendar, red means money owed.', 'Sin rojo: en el calendario el rojo significa dinero pendiente.') }}</span>
            </fieldset>

            <div class="flex flex-col gap-2" data-cy="account-hours">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Your hours', 'Tu horario') }}</span>
                <span class="text-[12px] text-ink-muted">{{ t('An owner changes them in Settings › Team', 'Lo cambia una persona propietaria en Ajustes › Equipo') }}</span>
              </div>
              <p v-if="!ownHours" class="text-[12.5px] text-ink-muted">
                {{ anyHours ? t("You follow the clinic's hours:", 'Sigues el horario de la clínica:') : t('No hours set yet, for you or the clinic.', 'Aún no hay horario, ni tuyo ni de la clínica.') }}
              </p>
              <div v-if="anyHours" class="overflow-hidden rounded-ctl border border-line">
                <div v-for="(r, i) in weekRows" :key="r.key" class="flex items-center gap-3 px-3.5 py-2 text-[13.5px]" :class="i ? 'border-t border-line-divider' : ''">
                  <span class="w-[90px] shrink-0 font-semibold text-ink-900">{{ r.day }}</span>
                  <span v-if="r.ranges.length" class="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12.5px] text-ink-700">
                    <span v-for="range in r.ranges" :key="range" class="whitespace-nowrap">{{ range }}</span>
                  </span>
                  <span v-else class="font-mono text-[12.5px] text-ink-faint">{{ t('Not working', 'No trabaja') }}</span>
                </div>
              </div>
            </div>

            <div
              class="flex items-center gap-3 rounded-ctl border px-3.5 py-3 text-[13.5px]"
              :class="me?.online_booking_enabled ? 'border-success-border bg-success-bg' : 'border-line bg-surface-subtle'"
              data-cy="account-online-booking"
            >
              <template v-if="me?.online_booking_enabled">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-success-text" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                <span><strong class="text-success-text">{{ t('Patients can book you online', 'Los pacientes pueden reservarte online') }}</strong><span class="text-ink-500"> {{ t('within your hours.', 'en tu horario.') }}</span></span>
              </template>
              <span v-else class="text-ink-500">{{ t("Patients can't book you online. An owner turns it on in Settings › Team.", 'Los pacientes no pueden reservarte online. Lo activa una persona propietaria en Ajustes › Equipo.') }}</span>
            </div>
          </section>

          <!-- 3. Idioma -->
          <section id="idioma" aria-labelledby="h-idioma" class="flex scroll-mt-6 flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
            <div class="flex-1">
              <h2 id="h-idioma" class="text-[16px] font-bold text-ink-900">{{ t('Language', 'Idioma') }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('Applies at once, and only to you.', 'Se aplica al momento y solo a ti.') }}</p>
            </div>
            <div role="radiogroup" aria-labelledby="h-idioma" class="flex gap-0.5 rounded-[11px] border border-chip-border bg-chip-bg p-[3px] sm:w-[280px]" data-cy="account-language">
              <button
                v-for="opt in LANGUAGES"
                :key="opt.value"
                type="button"
                role="radio"
                :aria-checked="langPreference === opt.value"
                :disabled="savingLang"
                :lang="opt.value"
                :data-lang="opt.value"
                class="h-10 flex-1 rounded-[8px] text-[13.5px] font-semibold"
                :class="langPreference === opt.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'"
                @click="chooseLanguage(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </section>

          <!-- 4. Seguridad -->
          <section id="seguridad" aria-labelledby="h-seg" class="flex scroll-mt-6 flex-col rounded-card border border-line bg-surface">
            <div class="px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
              <h2 id="h-seg" class="text-[16px] font-bold text-ink-900">{{ t('Security', 'Seguridad') }}</h2>
              <p v-if="lastSignIn" class="mt-1 text-[13px] text-ink-muted" data-cy="account-last-sign-in">{{ t('Last sign-in:', 'Último inicio de sesión:') }} {{ lastSignIn }}.</p>
            </div>

            <!-- Password -->
            <div class="flex flex-col gap-3.5 border-t border-line-divider px-4 py-4 sm:px-6">
              <div class="flex items-center gap-3">
                <div class="flex-1">
                  <p class="text-[14px] font-semibold text-ink-900">{{ t('Password', 'Contraseña') }}</p>
                  <p class="text-[12.5px] text-ink-muted">{{ t('At least 8 characters, and not one that has appeared in known breaches.', 'Al menos 8 caracteres, y que no aparezca en filtraciones conocidas.') }}</p>
                </div>
                <button
                  v-if="!passwordOpen"
                  type="button"
                  data-cy="account-password-open"
                  class="h-9 touch:h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
                  @click="passwordOpen = true"
                >
                  {{ t('Change…', 'Cambiar…') }}
                </button>
              </div>
              <form v-if="passwordOpen" class="grid grid-cols-1 gap-3 sm:grid-cols-2" data-cy="account-password-form" @submit.prevent="changePassword">
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('New password', 'Nueva contraseña') }}
                  <input v-model="newPassword" data-cy="account-new-password" type="password" autocomplete="new-password" required minlength="8" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Repeat it', 'Repítela') }}
                  <input v-model="confirmPassword" data-cy="account-confirm-password" type="password" autocomplete="new-password" required minlength="8" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </label>
                <p v-if="confirmPassword" class="text-[12.5px] sm:col-span-2" :class="passwordsMatch ? 'text-success-text' : 'text-warning-text'">
                  {{ passwordsMatch ? t('They match', 'Coinciden') : t("They don't match yet", 'Aún no coinciden') }}
                </p>
                <div class="flex gap-2 sm:col-span-2">
                  <UiBtn type="submit" variant="primary" data-cy="account-password-submit" :disabled="savingPassword">{{ savingPassword ? t('Saving…', 'Guardando…') : t('Change password', 'Cambiar contraseña') }}</UiBtn>
                  <UiBtn type="button" variant="secondary" @click="closePassword">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                </div>
              </form>
            </div>

            <!-- Two-factor -->
            <div class="flex flex-col gap-3 border-t border-line-divider px-4 py-4 sm:px-6" data-testid="two-factor-card">
              <div class="flex items-center gap-3">
                <div class="flex-1">
                  <p class="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink-900">
                    {{ t('Two-factor authentication', 'Verificación en dos pasos') }}
                    <UiPill v-if="twoFactorEnabled" tone="success">{{ t('On', 'Activada') }}</UiPill>
                    <UiPill v-else-if="twoFactorEnabled === false" tone="neutral">{{ t('Off', 'Desactivada') }}</UiPill>
                  </p>
                  <p v-if="twoFactorEnabled && twoFactorSince" class="text-[12.5px] text-ink-muted">
                    {{ t(`With an authenticator app since ${formatLongDate(twoFactorSince)}.`, `Con una app de autenticación desde el ${formatLongDate(twoFactorSince)}.`) }}
                  </p>
                  <p v-else-if="twoFactorEnabled === false" class="text-[12.5px] text-ink-muted">
                    {{ t('Ask for a 6-digit code from an authenticator app on your phone every time you sign in, so a stolen password is not enough on its own.', 'Pide un código de 6 dígitos de una app de autenticación en tu móvil cada vez que inicias sesión, para que una contraseña robada no baste por sí sola.') }}
                  </p>
                  <p v-if="twoFactorEnabled && store.requireTwoFactor" class="text-[12.5px] text-ink-500">
                    {{ t('Your clinic requires two-factor authentication, so it stays on.', 'Tu clínica exige la verificación en dos pasos, así que permanece activada.') }}
                  </p>
                </div>
                <button
                  v-if="twoFactorEnabled && !store.requireTwoFactor && !settingUpTwoFactor"
                  type="button"
                  data-cy="account-two-factor-off"
                  class="h-9 touch:h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3.5 text-[13.5px] font-semibold text-ink-700 hover:bg-surface-subtle"
                  @click="confirmingTwoFactorOff = true"
                >
                  {{ t('Turn off…', 'Desactivar…') }}
                </button>
                <UiBtn v-else-if="twoFactorEnabled === false && !settingUpTwoFactor" type="button" variant="primary" class="shrink-0" @click="settingUpTwoFactor = true">
                  {{ t('Set up two-factor', 'Configurar verificación en dos pasos') }}
                </UiBtn>
              </div>
              <AuthTwoFactorEnroll v-if="settingUpTwoFactor" @enabled="onTwoFactorEnabled" @cancel="settingUpTwoFactor = false" />
            </div>

            <!-- Other devices -->
            <div class="flex flex-col gap-3 border-t border-line-divider px-4 pb-5 pt-4 sm:flex-row sm:items-center sm:px-6">
              <div class="flex-1">
                <p class="text-[14px] font-semibold text-ink-900">{{ t('Other devices', 'Otros dispositivos') }}</p>
                <p class="text-[12.5px] text-ink-muted">{{ t('Left yourself signed in on the front-desk iPad? Sign out everywhere except here.', '¿Dejaste la sesión abierta en el iPad de recepción? Ciérrala en todos menos en este.') }}</p>
              </div>
              <button
                type="button"
                data-cy="account-sign-out-others"
                :disabled="signingOutOthers || signedOutOthers"
                class="h-9 touch:h-11 shrink-0 self-start rounded-ctl border px-3.5 text-[13.5px] font-semibold sm:self-auto"
                :class="signedOutOthers ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'"
                @click="signOutOthers"
              >
                {{ signedOutOthers ? t('Signed out', 'Sesiones cerradas') : signingOutOthers ? t('Signing out…', 'Cerrando…') : t('Sign out the others', 'Cerrar las demás') }}
              </button>
            </div>
          </section>

          <!-- 5. Remove my access: set apart -->
          <section id="acceso" aria-labelledby="h-del" data-cy="account-remove-access" class="mt-4 flex scroll-mt-6 flex-col gap-3 rounded-card border border-danger-border bg-surface p-4 sm:p-6">
            <h2 id="h-del" class="text-[16px] font-bold text-danger-text">{{ t('Remove my access', 'Eliminar mi acceso') }}</h2>
            <p class="text-[13.5px] leading-relaxed text-ink-500">
              {{
                t(
                  "Your login stops working at once and you're signed out of QuiroFlow. Your name stays on the appointments, payments and records that already exist: they're the clinic's history. To come back, an owner would need to invite you again.",
                  'Tu usuario deja de funcionar al momento y sales de QuiroFlow. Tu nombre se queda en las citas, cobros y registros que ya existen: son historia de la clínica. Para volver, una persona propietaria tendría que invitarte de nuevo.',
                )
              }}
            </p>
            <div v-if="soleOwner" data-cy="account-sole-owner" class="flex items-start gap-2.5 rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="mt-0.5 shrink-0 text-warning-accent" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.5" /></svg>
              <span>
                <strong class="text-warning-text">{{ t("You're the only owner.", 'Eres la única persona propietaria.') }}</strong>
                {{ t('Make someone else an owner in Settings › Team before removing your access. To close the whole clinic account, write to', 'Nombra a otra en Ajustes › Equipo antes de eliminar tu acceso. Si quieres cerrar la cuenta de la clínica entera, escribe a') }}
                <a href="mailto:hola@quiroflow.com" class="font-medium text-brand-text underline">hola@quiroflow.com</a>.
              </span>
            </div>
            <button
              type="button"
              data-cy="account-remove-access-open"
              :disabled="soleOwner"
              class="h-9 touch:h-11 self-start rounded-ctl border bg-surface px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
              :class="soleOwner ? '' : 'border-danger-border text-danger-text hover:bg-danger-bg'"
              @click="confirmingDelete = true"
            >
              {{ t('Remove my access…', 'Eliminar mi acceso…') }}
            </button>
          </section>
        </main>
      </div>
    </div>

    <!-- Unsaved changes: only "Tú" and "Tu agenda" wait for Guardar -->
    <div v-if="dirty" role="status" data-cy="account-unsaved" class="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-[720px] items-center gap-3 rounded-card bg-ink-900 py-3 pl-5 pr-3 text-surface-page shadow-popover">
      <span class="flex-1 text-[14px] font-semibold">{{ t('You have unsaved changes', 'Tienes cambios sin guardar') }}</span>
      <button type="button" data-cy="account-discard" class="h-9 touch:h-11 rounded-ctl px-3.5 text-[14px] font-semibold text-surface-page hover:opacity-80" @click="discardProfile">{{ t('Discard', 'Descartar') }}</button>
      <button type="button" data-cy="account-save" :disabled="savingProfile" class="h-9 touch:h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-60" @click="saveProfile">
        {{ savingProfile ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
      </button>
    </div>

    <UiConfirmDialog
      v-if="confirmingTwoFactorOff"
      :title="t('Turn off two-factor authentication?', '¿Desactivar la verificación en dos pasos?')"
      :confirm-label="t('Turn off', 'Desactivar')"
      :cancel-label="t('Keep it on', 'Mantenerla activada')"
      :busy="removingTwoFactor"
      @confirm="removeTwoFactor"
      @cancel="confirmingTwoFactorOff = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">
        {{ t("Signing in will only need your password. If someone gets hold of it, they'll be able to open your account and see patients' records.", 'Para entrar bastará tu contraseña. Si alguien la consigue, podrá abrir tu cuenta y ver los datos de los pacientes.') }}
      </p>
      <p class="text-[13px] text-ink-muted">{{ t('You can turn it back on from this page whenever you like.', 'Puedes volver a activarla cuando quieras desde esta página.') }}</p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="confirmingDelete"
      tone="danger"
      :title="t('Remove your access to QuiroFlow?', '¿Eliminar tu acceso a QuiroFlow?')"
      :confirm-label="t('Remove my access', 'Eliminar mi acceso')"
      :cancel-label="t('No, go back', 'No, volver')"
      :confirm-word="t('DELETE', 'ELIMINAR')"
      :busy="deletingAccount"
      @confirm="deleteAccount"
      @cancel="confirmingDelete = false"
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5 rounded-ctl border border-danger-border bg-danger-bg px-3.5 py-3">
          <span class="text-[12px] font-bold tracking-wide text-danger-text">{{ t('GOES', 'SE VA') }}</span>
          <span class="text-[13.5px] leading-snug text-ink-900">{{ t("Your login and password, at once. You're signed out on all your devices.", 'Tu usuario y tu contraseña, al momento. Sales de QuiroFlow en todos tus dispositivos.') }}</span>
        </div>
        <div class="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3">
          <span class="text-[12px] font-bold tracking-wide text-ink-muted">{{ t('STAYS', 'SE QUEDA') }}</span>
          <span class="text-[13.5px] leading-snug text-ink-900">{{ t("Your name on appointments, payments, invoices and notes. They are the clinic's history.", 'Tu nombre en citas, cobros, facturas y notas. Son historia de la clínica.') }}</span>
        </div>
      </div>
      <p class="text-[13px] text-ink-muted">{{ t("You can't undo this yourself. To come back, an owner would need to invite you.", 'No puedes deshacerlo tú. Para volver, una persona propietaria tendría que invitarte.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
