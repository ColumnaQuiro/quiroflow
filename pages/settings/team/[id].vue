<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { hoursProblems, normalizeHours } from '~/utils/clinicHours'
import { CALENDAR_PALETTE } from '~/utils/calendarPalette'
import { formatEur, formatShortDate } from '~/utils/billing'

// One person on the team, everything about them on one page. What used to be
// inline toggles in a table (practitioner, online booking, hours) plus what
// had no place at all: their role, their clinics, their colour for someone
// else, owner, and deactivating someone who has left.
//
// One Guardar for the profile, access and patients sections. Owner,
// security and deactivating act at once, each behind its own confirmation,
// because each is a decision on its own rather than part of an edit.

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { showToast } = useToast()
const memberId = route.params.id as string

interface Form {
  full_name: string
  color: string
  role_id: string | null
  is_practitioner: boolean
  online_booking_enabled: boolean
  clinic_ids: string[]
  business_hours: BusinessHours
}
interface Override {
  id: string
  duration_minutes: number | null
  price_cents: number | null
  type: { id: string; name: string; duration_minutes: number; default_price_cents: number } | null
}

const loaded = ref(false)
const missing = ref(false)
const form = ref<Form | null>(null)
const original = ref('')
const isOwner = ref(false)
const deletedAt = ref<string | null>(null)
const createdAt = ref<string | null>(null)
const photoPath = ref<string | null>(null)
const roles = ref<{ id: string; name: string }[]>([])
const others = ref<{ id: string; full_name: string; is_practitioner: boolean }[]>([])
const overrides = ref<Override[]>([])
const email = ref<string | null>(null)
const lastSignInAt = ref<string | null>(null)
const twoFactor = ref(false)
const requireTwoFactor = ref(false)
const futureCount = ref(0)

const isMe = computed(() => store.teamMember?.id === memberId)

async function load() {
  if (!store.accountId) await store.load()
  const accountId = store.accountId!
  const [m, links, r, all, ov, tf, acc, future] = await Promise.all([
    supabase.from('team_members').select('id, full_name, color, role_id, is_practitioner, online_booking_enabled, business_hours, is_owner, deleted_at, created_at, photo_storage_path').eq('id', memberId).maybeSingle(),
    supabase.from('team_member_clinics').select('clinic_id').eq('team_member_id', memberId),
    supabase.from('account_roles').select('id, name').order('is_system', { ascending: false }).order('name'),
    supabase.from('team_members').select('id, full_name, is_practitioner').eq('account_id', accountId).is('deleted_at', null).neq('id', memberId).order('full_name'),
    supabase.from('appointment_type_overrides').select('id, duration_minutes, price_cents, type:appointment_types(id, name, duration_minutes, default_price_cents)').eq('team_member_id', memberId),
    supabase.rpc('team_two_factor_status', { p_account_id: accountId }),
    supabase.from('accounts').select('require_two_factor').eq('id', accountId).maybeSingle(),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('practitioner_id', memberId).is('deleted_at', null).neq('status', 'cancelled').gte('starts_at', new Date().toISOString()),
  ])
  loaded.value = true
  if (!m.data) {
    missing.value = true
    return
  }
  const f: Form = {
    full_name: m.data.full_name,
    color: m.data.color,
    role_id: m.data.role_id,
    is_practitioner: m.data.is_practitioner,
    online_booking_enabled: m.data.online_booking_enabled,
    clinic_ids: (links.data ?? []).map((l) => l.clinic_id).sort(),
    business_hours: normalizeHours(m.data.business_hours as BusinessHours | null),
  }
  form.value = f
  original.value = JSON.stringify(f)
  isOwner.value = m.data.is_owner
  deletedAt.value = m.data.deleted_at
  createdAt.value = m.data.created_at
  photoPath.value = m.data.photo_storage_path
  roles.value = r.data ?? []
  others.value = all.data ?? []
  overrides.value = ((ov.data ?? []) as unknown as Override[]).filter((o) => o.type).sort((a, b) => a.type!.name.localeCompare(b.type!.name, 'es'))
  twoFactor.value = ((tf.data ?? []) as { team_member_id: string; enrolled: boolean }[]).some((x) => x.team_member_id === memberId && x.enrolled)
  requireTwoFactor.value = !!acc.data?.require_two_factor
  futureCount.value = future.count ?? 0
  // Email and last sign-in live in auth, which only the server can read.
  useStaffFetch<{ members: { id: string; email: string | null; lastSignInAt: string | null }[] }>('/api/team-members/activity')
    .then((res) => {
      const me = res.members.find((x) => x.id === memberId)
      email.value = me?.email ?? null
      lastSignInAt.value = me?.lastSignInAt ?? null
    })
    .catch(() => {})
}
onMounted(load)

// --- Labels ---------------------------------------------------------------------------
function roleLabel(name: string) {
  return name === 'Owner' ? t('Owner', 'Propietario') : name === 'Practitioner' ? t('Practitioner', 'Profesional') : name === 'Front Desk' ? t('Front Desk', 'Recepción') : name
}
const initials = computed(() => (form.value?.full_name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·')
const activeClinics = computed(() => store.clinics)
const hasOwnHours = computed(() => !!form.value && Object.values(form.value.business_hours).some((w) => (w ?? []).length > 0))
const SECTIONS = computed(() => [
  { id: 'perfil', label: t('Profile', 'Perfil') },
  { id: 'acceso', label: t('Access', 'Acceso') },
  { id: 'pacientes', label: t('Sees patients', 'Atiende pacientes') },
  { id: 'seguridad', label: t('Security', 'Seguridad') },
  ...(isMe.value || deletedAt.value ? [] : [{ id: 'desactivar', label: t('Deactivate', 'Desactivar') }]),
])

// --- Editing -----------------------------------------------------------------------------
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== original.value)
const problems = computed(() => (form.value ? hoursProblems(form.value.business_hours) : {}))
const nameMissing = computed(() => !!form.value && !form.value.full_name.trim())
const noClinic = computed(() => !!form.value && form.value.is_practitioner && form.value.clinic_ids.length === 0)
const canSave = computed(() => !nameMissing.value && !noClinic.value && Object.keys(problems.value).length === 0)

function toggleClinic(id: string) {
  if (!form.value) return
  const ids = form.value.clinic_ids
  form.value.clinic_ids = (ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id]).sort()
}
// With no hours of their own the week is not shown: seven days reading
// "Closed" would say the opposite of what an empty week means (bookable
// whenever the clinic is open). It opens when someone sets their own.
const ownHoursOpen = ref(false)
function clearHours() {
  if (form.value) form.value.business_hours = normalizeHours({})
  ownHoursOpen.value = false
}

const saving = ref(false)
const tried = ref(false)
const seatRefused = ref('')
async function save() {
  if (!form.value) return
  tried.value = true
  if (!canSave.value) {
    showToast(t('Some fields need fixing before this can be saved.', 'Hay campos por corregir antes de guardar.'), 'error')
    return
  }
  saving.value = true
  seatRefused.value = ''
  const f = form.value
  const before = JSON.parse(original.value) as Form
  const values = {
    full_name: f.full_name.trim(),
    color: f.color,
    role_id: f.role_id,
    is_practitioner: f.is_practitioner,
    // Nobody is bookable online who does not see patients.
    online_booking_enabled: f.is_practitioner && f.online_booking_enabled,
    business_hours: f.business_hours,
  }
  // .select().single() so a write RLS refuses errors instead of "succeeding"
  // on zero rows.
  const { error } = await supabase.from('team_members').update(values).eq('id', memberId).select('id').single()
  if (error) {
    saving.value = false
    // The seat cap trigger (PT402) explains itself.
    if (error.code === 'PT402') seatRefused.value = error.message
    else showToast(error.message, 'error', 8000)
    return
  }
  const added = f.clinic_ids.filter((c) => !before.clinic_ids.includes(c))
  const removed = before.clinic_ids.filter((c) => !f.clinic_ids.includes(c))
  if (added.length) {
    const { error: e } = await supabase.from('team_member_clinics').insert(added.map((clinic_id) => ({ team_member_id: memberId, clinic_id })))
    if (e) {
      saving.value = false
      showToast(e.message, 'error', 8000)
      return
    }
  }
  if (removed.length) {
    const { error: e } = await supabase.from('team_member_clinics').delete().eq('team_member_id', memberId).in('clinic_id', removed)
    if (e) {
      saving.value = false
      showToast(e.message, 'error', 8000)
      return
    }
  }
  saving.value = false
  tried.value = false
  f.online_booking_enabled = values.online_booking_enabled
  original.value = JSON.stringify(f)
  // Your own name, colour and role are read from the store everywhere.
  if (isMe.value) await store.load()
  showToast(t('Saved', 'Guardado'))
}
function discard() {
  form.value = JSON.parse(original.value)
  ownHoursOpen.value = false
  tried.value = false
  seatRefused.value = ''
}

// --- Photo --------------------------------------------------------------------------------
async function removePhoto() {
  const { error } = await supabase.from('team_members').update({ photo_storage_path: null }).eq('id', memberId)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  photoPath.value = null
}
async function reloadPhoto() {
  const { data } = await supabase.from('team_members').select('photo_storage_path').eq('id', memberId).maybeSingle()
  photoPath.value = data?.photo_storage_path ?? null
}

// --- Owner ----------------------------------------------------------------------------------
const ownerConfirm = ref(false)
const ownerBusy = ref(false)
async function setOwner() {
  ownerBusy.value = true
  try {
    await useStaffFetch(`/api/team-members/${memberId}/owner`, { method: 'POST', body: { isOwner: !isOwner.value } })
    isOwner.value = !isOwner.value
    showToast(isOwner.value ? t('Now an owner.', 'Ahora es propietario.') : t('No longer an owner.', 'Ya no es propietario.'))
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? e?.message ?? String(e), 'error', 8000)
  } finally {
    ownerBusy.value = false
    ownerConfirm.value = false
  }
}

// --- Security ----------------------------------------------------------------------------------
const resetPasswordOpen = ref(false)
const resetTwoFactorOpen = ref(false)
const securityBusy = ref(false)
async function sendPasswordReset() {
  securityBusy.value = true
  try {
    const res = await useStaffFetch<{ email: string }>(`/api/team-members/${memberId}/reset-password`, { method: 'POST' })
    showToast(t(`Password reset email sent to ${res.email}.`, `Correo de restablecimiento enviado a ${res.email}.`))
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not send password reset.', 'No se pudo enviar el restablecimiento de contraseña.'), 'error', 8000)
  } finally {
    securityBusy.value = false
    resetPasswordOpen.value = false
  }
}
async function resetTwoFactor() {
  securityBusy.value = true
  try {
    await useStaffFetch(`/api/team-members/${memberId}/reset-two-factor`, { method: 'POST' })
    twoFactor.value = false
    showToast(t('Two-factor reset.', 'Verificación en dos pasos restablecida.'))
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not reset two-factor.', 'No se pudo restablecer la verificación en dos pasos.'), 'error', 8000)
  } finally {
    securityBusy.value = false
    resetTwoFactorOpen.value = false
  }
}

// --- Deactivate / reactivate -------------------------------------------------------------------
const deactivateOpen = ref(false)
const reassignTo = ref<string>('')
const deactivating = ref(false)
async function deactivate() {
  deactivating.value = true
  try {
    await useStaffFetch(`/api/team-members/${memberId}/deactivate`, { method: 'POST', body: { reassignTo: reassignTo.value || null } })
    showToast(t(`${form.value?.full_name} deactivated.`, `${form.value?.full_name} desactivado.`))
    original.value = JSON.stringify(form.value)
    router.push('/settings/team')
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? e?.message ?? String(e), 'error', 8000)
  } finally {
    deactivating.value = false
    deactivateOpen.value = false
  }
}
async function reactivate() {
  try {
    await useStaffFetch(`/api/team-members/${memberId}/reactivate`, { method: 'POST' })
    deletedAt.value = null
    showToast(t('Active again.', 'Vuelve a estar activo.'))
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? e?.message ?? String(e), 'error', 8000)
  }
}

// --- Leaving with unsaved changes --------------------------------------------------------------
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

const inputClass = 'h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const hint = 'text-[12.5px] font-normal leading-snug text-ink-muted'
const card = 'flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-6'
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        <span aria-hidden="true">›</span>
        <NuxtLink to="/settings/team" class="font-semibold text-brand-text hover:underline" data-cy="member-back">{{ t('Team', 'Equipo') }}</NuxtLink>
      </nav>
      <div v-if="form" class="flex flex-wrap items-center gap-3">
        <span class="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold text-surface" :style="{ backgroundColor: form.color }">{{ initials }}</span>
        <h1 class="text-[20px] font-bold text-ink-900" data-cy="member-title">{{ form.full_name || t('Untitled', 'Sin nombre') }}</h1>
        <span v-if="isMe" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12.5px] font-bold text-chip-text">{{ t('You', 'Tú') }}</span>
        <span v-if="isOwner" class="rounded-pill bg-brand-tint px-2.5 py-0.5 text-[12.5px] font-bold text-brand-text" data-cy="member-owner-chip">{{ t('Owner', 'Propietario') }}</span>
        <span v-if="deletedAt" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12.5px] font-bold text-chip-text" data-cy="member-deactivated-chip">{{ t('Deactivated', 'Desactivado') }}</span>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6 pb-32">
        <SettingsNav />
        <p v-if="loaded && missing" class="text-[14px] text-ink-muted" data-cy="member-missing">
          {{ t('This person is not on your team.', 'Esta persona no está en tu equipo.') }}
          <NuxtLink to="/settings/team" class="text-brand-text hover:underline">{{ t('Back to the team', 'Volver al equipo') }}</NuxtLink>
        </p>
        <template v-else-if="form">
          <nav :aria-label="t('Sections', 'Secciones')" class="sticky top-0 hidden w-[180px] shrink-0 flex-col gap-0.5 self-start 2xl:flex">
            <a v-for="s in SECTIONS" :key="s.id" :href="`#${s.id}`" class="flex min-h-10 items-center rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle">{{ s.label }}</a>
          </nav>

          <main class="flex min-w-0 max-w-[720px] flex-1 flex-col gap-6" data-cy="member-page" :data-ready="loaded ? 'true' : undefined">
            <p v-if="deletedAt" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-subtle px-4 py-3 text-[14px] text-ink-700">
              <span class="flex-1">{{ t(`Deactivated ${formatShortDate(deletedAt)}: cannot sign in and is off the calendar. Their appointments, notes and payments are kept.`, `Desactivado el ${formatShortDate(deletedAt)}: no puede entrar y no aparece en el calendario. Sus citas, notas y cobros se conservan.`) }}</span>
              <button type="button" data-cy="member-reactivate" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="reactivate">{{ t('Reactivate', 'Reactivar') }}</button>
            </p>

            <!-- Perfil -->
            <section id="perfil" aria-labelledby="h-perfil" :class="card">
              <h2 id="h-perfil" class="text-[16px] font-bold text-ink-900">{{ t('Profile', 'Perfil') }}</h2>
              <div class="flex items-center gap-4">
                <SettingsTeamMemberPhotoUpload :account-id="store.accountId!" :team-member-id="memberId" :photo-storage-path="photoPath" :initials="initials" :color="form.color" :size="64" @uploaded="reloadPhoto" />
                <div class="flex flex-col gap-1">
                  <span class="text-[13.5px] text-ink-700">{{ t('Click the photo to change it.', 'Pulsa la foto para cambiarla.') }}</span>
                  <button v-if="photoPath" type="button" data-cy="member-photo-remove" class="self-start text-[13.5px] font-semibold text-brand-text hover:underline" @click="removePhoto">{{ t('Remove photo', 'Quitar foto') }}</button>
                </div>
              </div>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input v-model="form.full_name" data-cy="member-name" type="text" :class="[inputClass, tried && nameMissing ? 'border-danger-text' : 'border-line-control']" />
                <span v-if="tried && nameMissing" class="text-[12.5px] font-semibold text-danger-text">{{ t('A name is needed.', 'Hace falta un nombre.') }}</span>
                <span :class="hint">{{ t('Shown on the calendar, to patients booking online, and on appointment messages.', 'Se ve en el calendario, al reservar online y en los mensajes de las citas.') }}</span>
              </label>
              <div class="flex flex-col gap-1.5">
                <span class="text-[13px] font-semibold text-ink-700">{{ t('Email', 'Email') }}</span>
                <span class="text-[15px] text-ink-900" data-cy="member-email">{{ email ?? '—' }}</span>
                <span :class="hint">{{ t('Their sign-in. Only they can change it, from Account Settings.', 'Su acceso. Solo esa persona puede cambiarlo, desde Ajustes de la Cuenta.') }}</span>
              </div>
              <fieldset class="flex flex-col gap-2">
                <legend class="mb-2 text-[13px] font-semibold text-ink-700">{{ t('Colour on the calendar', 'Color en el calendario') }}</legend>
                <div class="flex flex-wrap gap-2" role="radiogroup">
                  <button
                    v-for="c in CALENDAR_PALETTE"
                    :key="c.hex"
                    type="button"
                    role="radio"
                    :aria-checked="form.color.toLowerCase() === c.hex"
                    :aria-label="t(c.en, c.es)"
                    :title="t(c.en, c.es)"
                    data-cy="member-color"
                    class="flex h-11 w-11 items-center justify-center rounded-full border-2"
                    :class="form.color.toLowerCase() === c.hex ? 'border-ink-900' : 'border-transparent'"
                    @click="form.color = c.hex"
                  >
                    <span class="h-8 w-8 rounded-full" :style="{ backgroundColor: c.hex }" />
                  </button>
                </div>
              </fieldset>
            </section>

            <!-- Acceso -->
            <section id="acceso" aria-labelledby="h-acceso" :class="card">
              <h2 id="h-acceso" class="text-[16px] font-bold text-ink-900">{{ t('Access', 'Acceso') }}</h2>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Role', 'Rol') }}
                <select v-model="form.role_id" data-cy="member-role" :disabled="isMe" :class="[inputClass, 'border-line-control disabled:opacity-60']">
                  <option v-for="r in roles" :key="r.id" :value="r.id">{{ roleLabel(r.name) }}</option>
                </select>
                <span :class="hint">
                  <template v-if="isMe">{{ t('You cannot change your own role; another admin can.', 'No puedes cambiar tu propio rol; otro administrador sí.') }}</template>
                  <template v-else>{{ t('What they can see and do.', 'Qué puede ver y hacer.') }}</template>
                  <NuxtLink to="/settings/roles" class="font-semibold text-brand-text hover:underline">{{ t('See permissions', 'Ver permisos') }}</NuxtLink>
                </span>
              </label>
              <div class="flex items-start gap-3.5 border-t border-line-row pt-4">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="text-[14.5px] font-semibold text-ink-900">{{ t('Owner', 'Propietario') }}</span>
                  <span :class="hint">{{ t('Owners can do everything whatever their role, manage the subscription, and make others owners. There is always at least one.', 'Los propietarios pueden hacerlo todo sea cual sea su rol, gestionan la suscripción y nombran a otros propietarios. Siempre hay al menos uno.') }}</span>
                  <span v-if="!store.isOwner" :class="hint" data-cy="member-owner-only">{{ t('Only an owner can change this.', 'Solo un propietario puede cambiarlo.') }}</span>
                </div>
                <SettingsToggle data-cy="member-owner" :model-value="isOwner" :disabled="!store.isOwner || ownerBusy || !!deletedAt" :aria-label="t('Owner', 'Propietario')" @update:model-value="ownerConfirm = true" />
              </div>
              <dl class="grid grid-cols-2 gap-3 border-t border-line-row pt-4 text-[13.5px]">
                <div>
                  <dt class="text-ink-muted">{{ t('Last signed in', 'Último acceso') }}</dt>
                  <dd class="font-semibold text-ink-900" data-cy="member-last-sign-in">{{ lastSignInAt ? formatShortDate(lastSignInAt) : t('Never', 'Nunca') }}</dd>
                </div>
                <div>
                  <dt class="text-ink-muted">{{ t('On the team since', 'En el equipo desde') }}</dt>
                  <dd class="font-semibold text-ink-900">{{ createdAt ? formatShortDate(createdAt) : '—' }}</dd>
                </div>
              </dl>
            </section>

            <!-- Atiende pacientes -->
            <section id="pacientes" aria-labelledby="h-pacientes" :class="card">
              <div class="flex items-start gap-3.5">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 id="h-pacientes" class="text-[16px] font-bold text-ink-900">{{ t('Sees patients', 'Atiende pacientes') }}</h2>
                  <span :class="hint">{{ t('Shows in the calendar as a practitioner and takes a practitioner seat on your plan. Reception and admin staff do not.', 'Aparece en el calendario como profesional y ocupa una plaza de profesional en tu plan. Recepción y administración no.') }}</span>
                </div>
                <SettingsToggle v-model="form.is_practitioner" data-cy="member-practitioner" :aria-label="t('Sees patients', 'Atiende pacientes')" />
              </div>
              <p v-if="seatRefused" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] text-warning-text" data-cy="member-seat-refused">
                {{ seatRefused }}
                <NuxtLink to="/subscription" class="font-bold underline">{{ t('Add a seat', 'Añadir una plaza') }}</NuxtLink>
              </p>
              <template v-if="form.is_practitioner">
                <div class="flex items-start gap-3.5 border-t border-line-row pt-4">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="text-[14.5px] font-semibold text-ink-900">{{ t('Bookable online', 'Se puede reservar online') }}</span>
                    <span :class="hint">{{ t('Patients can pick them on your booking page.', 'Los pacientes pueden elegirle en tu página de reservas.') }}</span>
                  </div>
                  <SettingsToggle v-model="form.online_booking_enabled" data-cy="member-online" :aria-label="t('Bookable online', 'Se puede reservar online')" />
                </div>
                <div v-if="activeClinics.length > 1" class="flex flex-col gap-2 border-t border-line-row pt-4">
                  <span class="text-[14.5px] font-semibold text-ink-900">{{ t('Clinics', 'Sedes') }}</span>
                  <div class="flex flex-wrap gap-2">
                    <label v-for="c in activeClinics" :key="c.id" data-cy="member-clinic" class="flex h-11 items-center gap-2.5 rounded-ctl border px-3.5 text-[14px] font-semibold" :class="form.clinic_ids.includes(c.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'">
                      <input type="checkbox" class="h-[18px] w-[18px]" :checked="form.clinic_ids.includes(c.id)" @change="toggleClinic(c.id)" />{{ c.name }}
                    </label>
                  </div>
                  <span v-if="noClinic" class="text-[12.5px] font-semibold text-danger-text">{{ t('Pick at least one clinic.', 'Elige al menos una sede.') }}</span>
                </div>
                <div class="flex flex-col gap-3 border-t border-line-row pt-4">
                  <div class="flex items-center gap-3">
                    <span class="flex-1 text-[14.5px] font-semibold text-ink-900">{{ t('Their hours', 'Su horario') }}</span>
                    <button v-if="hasOwnHours || ownHoursOpen" type="button" data-cy="member-hours-clear" class="h-10 rounded-ctl px-3 text-[13.5px] font-semibold text-brand-text hover:bg-surface-subtle" @click="clearHours">{{ t("Use the clinic's hours", 'Usar el de la sede') }}</button>
                  </div>
                  <SettingsClinicHoursEditor
                    v-if="hasOwnHours || ownHoursOpen"
                    v-model="form.business_hours"
                    :problems="problems"
                    :empty-note="t('No days set yet: until one is, they can be booked whenever the clinic is open.', 'Aún sin días: hasta que marques alguno, se le puede reservar siempre que la sede esté abierta.')"
                  />
                  <div v-else class="flex flex-wrap items-center gap-3 rounded-ctl border border-line bg-surface-subtle px-3.5 py-3" data-cy="member-hours-none">
                    <span class="min-w-[220px] flex-1 text-[13.5px] leading-snug text-ink-700">{{ t("No hours of their own: they can be booked whenever their clinic is open. Set their own only if they work less than that.", 'Sin horario propio: se le puede reservar siempre que su sede esté abierta. Pon uno propio solo si trabaja menos que eso.') }}</span>
                    <button type="button" data-cy="member-hours-set" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="ownHoursOpen = true">{{ t('Set their own hours', 'Poner horario propio') }}</button>
                  </div>
                </div>
                <div class="flex flex-col gap-2 border-t border-line-row pt-4" data-cy="member-overrides">
                  <span class="text-[14.5px] font-semibold text-ink-900">{{ t('Their own durations and prices', 'Sus duraciones y precios propios') }}</span>
                  <p v-if="overrides.length === 0" :class="hint">{{ t('None: they use every appointment type as it is.', 'Ninguno: usa cada tipo de cita tal cual.') }}</p>
                  <ul v-else class="flex flex-col">
                    <li v-for="o in overrides" :key="o.id" class="flex flex-wrap items-center gap-2 border-t border-line-row py-2 text-[14px] first:border-t-0">
                      <NuxtLink :to="`/settings/appointment-types/${o.type!.id}#profesionales`" class="flex-1 font-semibold text-ink-900 hover:underline">{{ o.type!.name }}</NuxtLink>
                      <span class="text-ink-700">{{ o.duration_minutes ?? o.type!.duration_minutes }} min</span>
                      <span class="text-ink-700">{{ formatEur(o.price_cents ?? o.type!.default_price_cents ?? 0) }}</span>
                    </li>
                  </ul>
                  <span :class="hint">
                    {{ t('Edited on each appointment type.', 'Se editan en cada tipo de cita.') }}
                    <NuxtLink to="/settings/appointment-types" class="font-semibold text-brand-text hover:underline">{{ t('Appointment types', 'Tipos de cita') }}</NuxtLink>
                  </span>
                </div>
              </template>
            </section>

            <!-- Seguridad -->
            <section id="seguridad" aria-labelledby="h-seguridad" :class="card">
              <h2 id="h-seguridad" class="text-[16px] font-bold text-ink-900">{{ t('Security', 'Seguridad') }}</h2>
              <div class="flex flex-wrap items-center gap-3">
                <span class="flex-1 text-[14px] text-ink-700">
                  {{ t('Two-factor authentication', 'Verificación en dos pasos') }}:
                  <strong data-cy="member-2fa" :class="twoFactor ? 'text-success-text' : 'text-warning-text'">{{ twoFactor ? t('set up', 'configurada') : t('not set up', 'sin configurar') }}</strong>
                </span>
                <button v-if="twoFactor && !isMe && (!isOwner || store.isOwner)" type="button" data-cy="member-reset-2fa" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="resetTwoFactorOpen = true">{{ t('Reset two-factor', 'Restablecer') }}</button>
              </div>
              <p v-if="isMe" :class="hint">{{ t('Your own password and two-factor are in', 'Tu contraseña y tu verificación están en') }} <NuxtLink to="/account" class="font-semibold text-brand-text hover:underline">{{ t('Account Settings', 'Ajustes de la Cuenta') }}</NuxtLink>.</p>
              <div v-else class="flex flex-wrap items-center gap-3 border-t border-line-row pt-4">
                <span class="flex-1 text-[14px] text-ink-700">{{ t('Forgot their password? Send them an email to set a new one.', '¿Ha olvidado la contraseña? Envíale un email para crear una nueva.') }}</span>
                <button type="button" data-cy="member-reset-password" :disabled="!!deletedAt" class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-50" @click="resetPasswordOpen = true">{{ t('Send reset email', 'Enviar email') }}</button>
              </div>
            </section>

            <!-- Desactivar -->
            <section v-if="!isMe && !deletedAt" id="desactivar" aria-labelledby="h-desactivar" :class="card">
              <h2 id="h-desactivar" class="text-[16px] font-bold text-ink-900">{{ t('Deactivate', 'Desactivar') }}</h2>
              <p class="text-[14px] text-ink-700">{{ t('For someone who has left. They can no longer sign in and leave the calendar, their seat is freed, and everything they did — appointments, notes, payments — is kept under their name. You can reactivate them later.', 'Para quien ya no trabaja aquí. No podrá entrar, deja el calendario y libera su plaza; todo lo que hizo (citas, notas, cobros) se conserva a su nombre. Puedes reactivarle más adelante.') }}</p>
              <button type="button" data-cy="member-deactivate" :disabled="isOwner && !store.isOwner" class="h-11 self-start rounded-ctl border border-danger-border bg-surface px-4 text-[14px] font-semibold text-danger-text hover:bg-danger-bg disabled:opacity-50" @click="deactivateOpen = true">{{ t(`Deactivate ${form.full_name}`, `Desactivar a ${form.full_name}`) }}</button>
            </section>
          </main>
        </template>
      </div>
    </div>

    <div
      v-if="dirty"
      role="region"
      :aria-label="t('Unsaved changes', 'Cambios sin guardar')"
      data-cy="member-save-bar"
      class="absolute bottom-6 left-1/2 flex w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-center gap-2.5 rounded-card bg-ink-900 py-3 pl-5 pr-3 text-surface-page shadow-popover"
    >
      <span class="flex-1 text-[14px] font-semibold">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <button type="button" data-cy="member-discard" class="h-11 rounded-ctl border border-surface-page/30 px-3.5 text-[14px] font-semibold" @click="discard">{{ t('Discard', 'Descartar') }}</button>
      <button type="button" data-cy="member-save" :disabled="saving" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-70" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</button>
    </div>

    <UiConfirmDialog
      v-if="ownerConfirm && form"
      :title="isOwner ? t(`Remove ${form.full_name} as owner?`, `¿Quitar a ${form.full_name} como propietario?`) : t(`Make ${form.full_name} an owner?`, `¿Hacer propietario a ${form.full_name}?`)"
      :confirm-label="isOwner ? t('Remove owner', 'Quitar') : t('Make owner', 'Hacer propietario')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="ownerBusy"
      @confirm="setOwner"
      @cancel="ownerConfirm = false"
    >
      <p class="text-[14px] text-ink-500">{{ isOwner ? t('They keep their role and its permissions, but no longer manage the subscription or other owners.', 'Mantiene su rol y sus permisos, pero deja de gestionar la suscripción y los propietarios.') : t('They will be able to do everything, including the subscription, billing and removing you as owner.', 'Podrá hacerlo todo, incluida la suscripción, la facturación y quitarte a ti como propietario.') }}</p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="resetPasswordOpen && form"
      :title="t(`Send a password reset email to ${form.full_name}?`, `¿Enviar un email de restablecimiento a ${form.full_name}?`)"
      :confirm-label="t('Send', 'Enviar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="securityBusy"
      @confirm="sendPasswordReset"
      @cancel="resetPasswordOpen = false"
    >
      <p class="text-[14px] text-ink-500">{{ t(`It goes to ${email ?? 'their sign-in email'}. Their current password keeps working until they set a new one.`, `Llega a ${email ?? 'su email de acceso'}. Su contraseña actual sigue funcionando hasta que cree una nueva.`) }}</p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="resetTwoFactorOpen && form"
      tone="danger"
      :title="t(`Reset two-factor for ${form.full_name}?`, `¿Restablecer la verificación en dos pasos de ${form.full_name}?`)"
      :confirm-label="t('Reset', 'Restablecer')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="securityBusy"
      @confirm="resetTwoFactor"
      @cancel="resetTwoFactorOpen = false"
    >
      <p class="text-[14px] text-ink-500">
        {{
          requireTwoFactor
            ? t('Their authenticator app stops working for QuiroFlow, and they will set up a new one the next time they sign in.', 'Su app de autenticación dejará de funcionar para QuiroFlow y configurará una nueva la próxima vez que inicie sesión.')
            : t('Their authenticator app stops working for QuiroFlow and they will sign in with just their password until they set it up again.', 'Su app de autenticación dejará de funcionar para QuiroFlow e iniciará sesión solo con su contraseña hasta que la vuelva a configurar.')
        }}
      </p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="deactivateOpen && form"
      tone="danger"
      :title="t(`Deactivate ${form.full_name}?`, `¿Desactivar a ${form.full_name}?`)"
      :confirm-label="t('Deactivate', 'Desactivar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deactivating"
      @confirm="deactivate"
      @cancel="deactivateOpen = false"
    >
      <div class="flex flex-col gap-3" data-cy="member-deactivate-dialog">
        <p class="text-[14px] text-ink-500">{{ t('They are signed out and cannot sign in again. Everything they did is kept.', 'Se cierra su sesión y no podrá volver a entrar. Todo lo que hizo se conserva.') }}</p>
        <template v-if="futureCount > 0">
          <p class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] text-warning-text" data-cy="member-deactivate-future">
            <strong>{{ t(`${futureCount} appointments from now on are theirs.`, `Tiene ${futureCount} citas de aquí en adelante.`) }}</strong>
            {{ t('Pass them to someone else, or leave them to move one by one.', 'Pásalas a otra persona, o déjalas para moverlas una a una.') }}
          </p>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
            {{ t('Pass their appointments to', 'Pasar sus citas a') }}
            <select v-model="reassignTo" data-cy="member-reassign" :class="[inputClass, 'border-line-control']">
              <option value="">{{ t('Nobody — I will move them myself', 'Nadie: las moveré yo') }}</option>
              <option v-for="o in others.filter((x) => x.is_practitioner)" :key="o.id" :value="o.id">{{ o.full_name }}</option>
            </select>
          </label>
        </template>
      </div>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="leaveOpen"
      :title="t('Leave without saving?', '¿Salir sin guardar?')"
      :confirm-label="t('Leave', 'Salir')"
      :cancel-label="t('Stay', 'Quedarme')"
      @confirm="leaveAnyway"
      @cancel="stayHere"
    >
      <p class="text-[14px] text-ink-500">{{ t('Your changes to this person will be lost.', 'Se perderán los cambios en esta persona.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
