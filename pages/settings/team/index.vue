<script setup lang="ts">
import { formatShortDate } from '~/utils/billing'

// Settings -> Team: everyone who signs in, and who of them sees patients.
// Each person opens onto their own page (/settings/team/<id>) where
// everything about them is edited. The old Settings -> Practitioners page is
// the "Nombres importados sin vincular" section here: it never managed
// practitioners, only linked names on imported appointments to real people.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface MemberRow {
  id: string
  full_name: string
  color: string
  role_id: string | null
  photo_storage_path: string | null
  online_booking_enabled: boolean
  is_practitioner: boolean
  is_owner: boolean
  business_hours: unknown
  deleted_at: string | null
}
interface InviteRow {
  id: string
  email: string | null
  full_name: string | null
  role_id: string | null
  token: string
  is_practitioner: boolean | null
  link_practitioner_name: string | null
  created_at: string
  last_sent_at: string | null
}

const members = ref<MemberRow[]>([])
const clinicLinks = ref<Record<string, string[]>>({})
const invites = ref<InviteRow[]>([])
const roles = ref<{ id: string; name: string }[]>([])
const twoFactorEnrolled = ref<Set<string>>(new Set())
const requireTwoFactor = ref(false)
const myTwoFactorVerified = ref(false)
const seatAllowance = ref<number | null>(null)
const loading = ref(true)

const active = computed(() => members.value.filter((m) => !m.deleted_at))
const deactivated = computed(() => members.value.filter((m) => m.deleted_at))
const practitionersInUse = computed(() => active.value.filter((m) => m.is_practitioner).length)
const seatsLeft = computed(() => (seatAllowance.value === null ? null : Math.max(0, seatAllowance.value - practitionersInUse.value)))

async function load() {
  if (!store.accountId) await store.load()
  const accountId = store.accountId!
  const [m, links, inv, r, tf, acc, aal, seats] = await Promise.all([
    supabase.from('team_members').select('id, full_name, color, role_id, photo_storage_path, online_booking_enabled, is_practitioner, is_owner, business_hours, deleted_at').eq('account_id', accountId).order('full_name'),
    supabase.from('team_member_clinics').select('team_member_id, clinic_id'),
    supabase.from('account_invites').select('id, email, full_name, role_id, token, is_practitioner, link_practitioner_name, created_at, last_sent_at').is('accepted_at', null).order('created_at', { ascending: false }),
    supabase.from('account_roles').select('id, name').order('is_system', { ascending: false }).order('name'),
    supabase.rpc('team_two_factor_status', { p_account_id: accountId }),
    supabase.from('accounts').select('require_two_factor').eq('id', accountId).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('practitioner_seat_allowance', { target_account_id: accountId }),
  ])
  if (m.error) showToast(m.error.message, 'error')
  members.value = (m.data ?? []) as MemberRow[]
  const byMember: Record<string, string[]> = {}
  for (const l of links.data ?? []) (byMember[l.team_member_id] ??= []).push(l.clinic_id)
  clinicLinks.value = byMember
  invites.value = (inv.data ?? []) as InviteRow[]
  roles.value = r.data ?? []
  twoFactorEnrolled.value = new Set(((tf.data ?? []) as { team_member_id: string; enrolled: boolean }[]).filter((x) => x.enrolled).map((x) => x.team_member_id))
  requireTwoFactor.value = !!acc.data?.require_two_factor
  myTwoFactorVerified.value = aal.data?.currentLevel === 'aal2'
  seatAllowance.value = typeof seats.data === 'number' ? seats.data : null
  loading.value = false
  loadImportedNames()
}
onMounted(load)

// --- Labels -------------------------------------------------------------------------
function roleName(id: string | null) {
  const name = roles.value.find((r) => r.id === id)?.name
  if (!name) return t('No role', 'Sin rol')
  return name === 'Owner' ? t('Owner', 'Propietario') : name === 'Practitioner' ? t('Practitioner', 'Profesional') : name === 'Front Desk' ? t('Front Desk', 'Recepción') : name
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'
}
function clinicsText(id: string) {
  const ids = clinicLinks.value[id] ?? []
  const names = store.clinics.filter((c) => ids.includes(c.id)).map((c) => c.name)
  if (names.length === 0) return t('No clinic', 'Sin sede')
  return names.length === 1 ? names[0] : t(`${names.length} clinics`, `${names.length} sedes`)
}
function hasOwnHours(m: MemberRow) {
  return Object.values((m.business_hours as Record<string, unknown[]>) ?? {}).some((w) => Array.isArray(w) && w.length > 0)
}

// --- Filters ------------------------------------------------------------------------
const search = ref('')
const filter = ref<'all' | 'practitioners' | 'no2fa'>('all')
const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return active.value.filter((m) => {
    if (q && !m.full_name.toLowerCase().includes(q)) return false
    if (filter.value === 'practitioners') return m.is_practitioner
    if (filter.value === 'no2fa') return !twoFactorEnrolled.value.has(m.id)
    return true
  })
})
const membersWithoutTwoFactor = computed(() => active.value.filter((m) => !twoFactorEnrolled.value.has(m.id)))

// --- Reactivate ---------------------------------------------------------------------
async function reactivate(m: MemberRow) {
  try {
    await useStaffFetch(`/api/team-members/${m.id}/reactivate`, { method: 'POST' })
    showToast(t(`${m.full_name} is back.`, `${m.full_name} vuelve a estar activo.`))
    await load()
  } catch (e: any) {
    // The seat cap (402) explains itself.
    showToast(e?.data?.statusMessage ?? e?.message ?? String(e), 'error', 8000)
  }
}

// --- Invites --------------------------------------------------------------------------
const inviteOpen = ref(false)
const invitePrefill = ref<{ name?: string; link?: string }>({})
function openInvite(prefill: { name?: string; link?: string } = {}) {
  invitePrefill.value = prefill
  inviteOpen.value = true
}
function inviteLink(i: InviteRow) {
  return `${window.location.origin}/join?token=${i.token}`
}
async function copyInvite(i: InviteRow) {
  try {
    await navigator.clipboard.writeText(inviteLink(i))
    showToast(t('Link copied', 'Enlace copiado'))
  } catch {
    showToast(t('Could not copy the link.', 'No se pudo copiar el enlace.'), 'error')
  }
}
const resending = ref<string | null>(null)
async function resend(i: InviteRow) {
  resending.value = i.id
  try {
    await useStaffFetch('/api/invites/send', { method: 'POST', body: { inviteId: i.id } })
    showToast(t(`Sent again to ${i.email}.`, `Enviada de nuevo a ${i.email}.`))
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not send the email.', 'No se pudo enviar el email.'), 'error', 8000)
  } finally {
    resending.value = null
  }
}
const revokeFor = ref<InviteRow | null>(null)
async function revoke() {
  const i = revokeFor.value
  if (!i) return
  const { error } = await supabase.from('account_invites').delete().eq('id', i.id)
  revokeFor.value = null
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Invite revoked.', 'Invitación revocada.'))
  await load()
}
function inviteTitle(i: InviteRow) {
  return i.email ?? i.full_name ?? t('Link only', 'Solo enlace')
}
function inviteMeta(i: InviteRow) {
  const parts: string[] = []
  if (i.email && i.full_name) parts.push(i.full_name)
  parts.push(roleName(i.role_id))
  if (i.is_practitioner === true) parts.push(t('will see patients', 'atenderá pacientes'))
  else if (i.is_practitioner === false) parts.push(t('will not see patients', 'no atenderá pacientes'))
  if (i.link_practitioner_name) parts.push(t(`gets the imported appointments of "${i.link_practitioner_name}"`, `recibirá las citas importadas de «${i.link_practitioner_name}»`))
  parts.push(i.last_sent_at ? t(`sent ${formatShortDate(i.last_sent_at)}`, `enviada el ${formatShortDate(i.last_sent_at)}`) : t(`created ${formatShortDate(i.created_at)}`, `creada el ${formatShortDate(i.created_at)}`))
  return parts.join(' · ')
}

// --- Imported names (formerly Settings -> Practitioners) ----------------------------
// Appointments imported from PracticeHub carry the practitioner only as text
// (practitioner_name). They are linked to a real person here, or that person
// is invited and the appointments become theirs when they accept.
const importedNames = ref<{ name: string; count: number }[]>([])
const linkTarget = ref<Record<string, string>>({})
async function loadImportedNames() {
  const counts: Record<string, number> = {}
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('appointments')
      .select('practitioner_name')
      .is('practitioner_id', null)
      .not('practitioner_name', 'is', null)
      .is('deleted_at', null)
      .range(from, from + PAGE - 1)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    for (const a of data ?? []) counts[a.practitioner_name!] = (counts[a.practitioner_name!] ?? 0) + 1
    if (!data || data.length < PAGE) break
  }
  importedNames.value = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
const linkFor = ref<{ name: string; count: number; memberId: string } | null>(null)
function askLink(n: { name: string; count: number }) {
  const memberId = linkTarget.value[n.name]
  if (!memberId) return
  linkFor.value = { ...n, memberId }
}
const linking = ref(false)
async function link() {
  const l = linkFor.value
  if (!l || !store.accountId) return
  linking.value = true
  const { data, error } = await supabase
    .from('appointments')
    .update({ practitioner_id: l.memberId })
    .eq('account_id', store.accountId)
    .eq('practitioner_name', l.name)
    .is('practitioner_id', null)
    .select('id')
  linking.value = false
  linkFor.value = null
  if (error) {
    showToast(error.message, 'error')
    return
  }
  // An update RLS does not allow comes back empty rather than as an error, so
  // the count is what says whether it happened.
  const moved = data?.length ?? 0
  if (moved === 0) {
    showToast(t('Nothing was linked -- you may not have access to those appointments.', 'No se vinculó nada: puede que no tengas acceso a esas citas.'), 'error', 8000)
    return
  }
  showToast(t(`${moved} appointments linked.`, `${moved} citas vinculadas.`))
  await loadImportedNames()
}
function memberName(id: string) {
  return active.value.find((m) => m.id === id)?.full_name ?? ''
}

// --- Require two-factor ----------------------------------------------------------------
const savingRequirement = ref(false)
const requireConfirmOpen = ref(false)
function onRequireToggle() {
  if (!requireTwoFactor.value) requireConfirmOpen.value = true
  else setRequireTwoFactor(false)
}
async function setRequireTwoFactor(next: boolean) {
  requireConfirmOpen.value = false
  savingRequirement.value = true
  const { error } = await supabase.from('accounts').update({ require_two_factor: next }).eq('id', store.accountId!)
  savingRequirement.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  requireTwoFactor.value = next
  store.requireTwoFactor = next
  showToast(next ? t('Two-factor is now required.', 'La verificación en dos pasos ahora es obligatoria.') : t('Two-factor is now optional.', 'La verificación en dos pasos ahora es opcional.'))
}

// The old /settings/practitioners lands here with #importados.
onMounted(() => {
  if (window.location.hash === '#importados') nextTick(() => document.getElementById('importados')?.scrollIntoView())
})
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Team', 'Equipo')">
      <button type="button" data-cy="team-invite" class="h-9 touch:h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover" @click="openInvite()">
        {{ t('Invite', 'Invitar') }}
      </button>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-5" data-cy="team-page" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">{{ t('Who signs in to QuiroFlow, with which role, and who of them sees patients.', 'Quién entra en QuiroFlow, con qué rol, y quién atiende pacientes.') }}</p>

          <div v-if="seatAllowance !== null" class="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-3.5" data-cy="team-seats">
            <div class="flex flex-1 flex-col gap-2">
              <span class="text-[14px] text-ink-700">
                <strong>{{ t(`${practitionersInUse} of ${seatAllowance} practitioner seats`, `${practitionersInUse} de ${seatAllowance} plazas de profesional`) }}</strong>
                {{ t('on your plan · staff who do not see patients take no seat', 'en tu plan · el personal que no atiende pacientes no ocupa plaza') }}
              </span>
              <div role="progressbar" :aria-label="t('Seats used', 'Plazas usadas')" :aria-valuenow="practitionersInUse" aria-valuemin="0" :aria-valuemax="seatAllowance" class="h-1.5 overflow-hidden rounded-full bg-line-row">
                <div class="h-full bg-brand" :style="{ width: `${Math.min(100, (practitionersInUse / Math.max(1, seatAllowance)) * 100)}%` }" />
              </div>
            </div>
            <NuxtLink to="/subscription" class="text-[13.5px] font-semibold text-brand-text hover:underline">{{ t('Add seats', 'Añadir plazas') }}</NuxtLink>
          </div>

          <!-- Members -->
          <section aria-labelledby="h-members" class="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id="h-members" class="px-[18px] pt-[18px] text-[16px] font-bold text-ink-900">{{ t('Team', 'Equipo') }}</h2>
            <div class="flex flex-wrap items-center gap-2 px-[18px] pb-2.5 pt-3.5">
              <input v-model="search" type="search" data-cy="team-search" :aria-label="t('Search the team', 'Buscar en el equipo')" :placeholder="t('Search by name', 'Buscar por nombre')" class="h-9 touch:h-11 min-w-[200px] flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none" />
              <button
                v-for="f in [
                  { key: 'all', label: t(`All · ${active.length}`, `Todos · ${active.length}`) },
                  { key: 'practitioners', label: t(`Practitioners · ${practitionersInUse}`, `Profesionales · ${practitionersInUse}`) },
                  { key: 'no2fa', label: t(`Without two-factor · ${membersWithoutTwoFactor.length}`, `Sin verificación en dos pasos · ${membersWithoutTwoFactor.length}`) },
                ]"
                :key="f.key"
                type="button"
                :aria-pressed="filter === f.key"
                class="h-9 touch:h-11 rounded-pill border px-3 text-[13.5px] font-semibold"
                :class="filter === f.key ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'"
                @click="filter = f.key as 'all' | 'practitioners' | 'no2fa'"
              >
                {{ f.label }}
              </button>
            </div>
            <div v-if="loading" class="space-y-2 p-[18px]"><UiSkeleton v-for="i in 3" :key="i" class="h-14 w-full rounded-ctl" /></div>
            <NuxtLink
              v-for="m in visible"
              v-else
              :key="m.id"
              :to="`/settings/team/${m.id}`"
              data-cy="team-member-row"
              :data-member-id="m.id"
              class="flex min-h-[72px] items-center gap-3.5 border-t border-line-row px-[18px] py-3 hover:bg-surface-subtle"
            >
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-surface" :style="{ backgroundColor: m.color }">{{ initials(m.full_name) }}</span>
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <strong class="text-[15.5px] text-ink-900">{{ m.full_name }}</strong>
                  <span v-if="m.id === store.teamMember?.id" class="rounded-pill bg-chip-bg px-2 py-0.5 text-[12px] font-bold text-chip-text">{{ t('You', 'Tú') }}</span>
                  <span v-if="m.is_owner" class="rounded-pill bg-brand-tint px-2 py-0.5 text-[12px] font-bold text-brand-text" data-cy="team-row-owner">{{ t('Owner', 'Propietario') }}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 text-[12px] font-bold">
                  <span class="rounded-pill bg-chip-bg px-2 py-0.5 text-chip-text" data-cy="team-row-role">{{ roleName(m.role_id) }}</span>
                  <span v-if="m.is_practitioner" class="rounded-pill bg-info-bg px-2 py-0.5 text-info-text" data-cy="team-row-practitioner">{{ t('Practitioner', 'Profesional') }}</span>
                  <span v-else class="rounded-pill bg-chip-bg px-2 py-0.5 text-chip-text">{{ t('Does not see patients', 'No atiende pacientes') }}</span>
                  <template v-if="m.is_practitioner">
                    <span v-if="m.online_booking_enabled" class="rounded-pill bg-success-bg px-2 py-0.5 text-success-text">{{ t('Online booking', 'Reserva online') }}</span>
                    <span v-else class="rounded-pill bg-chip-bg px-2 py-0.5 text-chip-text">{{ t('Not bookable online', 'No se reserva online') }}</span>
                    <span v-if="hasOwnHours(m)" class="rounded-pill bg-chip-bg px-2 py-0.5 text-chip-text">{{ t('Own hours', 'Horario propio') }}</span>
                  </template>
                  <span class="rounded-pill bg-chip-bg px-2 py-0.5 text-chip-text">{{ clinicsText(m.id) }}</span>
                  <span v-if="twoFactorEnrolled.has(m.id)" class="rounded-pill bg-success-bg px-2 py-0.5 text-success-text">{{ t('Two-factor', 'Verificación en dos pasos') }}</span>
                  <span v-else class="rounded-pill bg-warning-bg px-2 py-0.5 text-warning-text">{{ t('No two-factor', 'Sin verificación en dos pasos') }}</span>
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </NuxtLink>
            <p v-if="!loading && visible.length === 0" class="border-t border-line-row px-[18px] py-5 text-[14px] text-ink-muted">{{ t('Nobody matches.', 'Nadie coincide.') }}</p>
            <details v-if="deactivated.length" class="border-t border-line" open data-cy="team-deactivated">
              <summary class="flex min-h-[52px] cursor-pointer items-center px-[18px] text-[14px] font-semibold text-ink-700">{{ t(`Deactivated · ${deactivated.length}`, `Desactivados · ${deactivated.length}`) }}</summary>
              <div v-for="m in deactivated" :key="m.id" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-3" data-cy="team-deactivated-row" :data-member-id="m.id">
                <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[13px] font-bold text-chip-text">{{ initials(m.full_name) }}</span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="text-[15px] text-ink-700">{{ m.full_name }}</strong>
                  <span class="text-[13px] text-ink-muted">{{ t(`Deactivated ${formatShortDate(m.deleted_at!)} · their appointments, notes and payments are kept`, `Desactivado el ${formatShortDate(m.deleted_at!)} · sus citas, notas y cobros se conservan`) }}</span>
                </div>
                <button type="button" data-cy="team-reactivate" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="reactivate(m)">{{ t('Reactivate', 'Reactivar') }}</button>
              </div>
            </details>
          </section>

          <!-- Pending invites -->
          <section v-if="invites.length" aria-labelledby="h-invites" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-6" data-cy="team-invites">
            <div class="flex flex-col gap-1">
              <h2 id="h-invites" class="text-[16px] font-bold text-ink-900">{{ t(`Pending invites · ${invites.length}`, `Invitaciones pendientes · ${invites.length}`) }}</h2>
              <p class="text-[13px] text-ink-muted">{{ t('Whoever opens the link joins with that role. Invites do not expire: revoke the ones you no longer want.', 'Quien abra el enlace entra con ese rol. Las invitaciones no caducan: revoca las que ya no quieras.') }}</p>
            </div>
            <div v-for="i in invites" :key="i.id" class="flex flex-wrap items-center gap-2.5 border-t border-line-row pt-3" data-cy="team-invite-row">
              <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                <strong class="text-[14.5px] text-ink-900">{{ inviteTitle(i) }}</strong>
                <span class="text-[13px] text-ink-500">{{ inviteMeta(i) }}</span>
              </div>
              <button type="button" data-cy="team-invite-copy" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="copyInvite(i)">{{ t('Copy link', 'Copiar enlace') }}</button>
              <button v-if="i.email" type="button" data-cy="team-invite-resend" :disabled="resending === i.id" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-60" @click="resend(i)">{{ t('Resend email', 'Reenviar email') }}</button>
              <button type="button" data-cy="team-invite-revoke" class="h-9 touch:h-11 rounded-ctl px-3.5 text-[14px] font-semibold text-ink-500 hover:bg-surface-subtle hover:text-ink-700" @click="revokeFor = i">{{ t('Revoke', 'Revocar') }}</button>
            </div>
          </section>

          <!-- Imported names -->
          <section v-if="importedNames.length" id="importados" aria-labelledby="h-imported" class="flex scroll-mt-4 flex-col gap-3 rounded-card border border-line bg-surface p-6" data-cy="team-imported">
            <div class="flex flex-col gap-1">
              <h2 id="h-imported" class="text-[16px] font-bold text-ink-900">{{ t(`Imported names not linked · ${importedNames.length}`, `Nombres importados sin vincular · ${importedNames.length}`) }}</h2>
              <p class="text-[13px] leading-snug text-ink-muted">{{ t('Appointments imported from PracticeHub that only carry the practitioner\'s name. Link them to someone on the team, or invite that person so they become theirs when they join.', 'Citas importadas de PracticeHub que solo traen el nombre del profesional. Vincúlalas a alguien del equipo, o invítale para que sean suyas al entrar.') }}</p>
            </div>
            <div v-for="n in importedNames" :key="n.name" class="flex flex-wrap items-center gap-2.5 border-t border-line-row pt-3" data-cy="team-imported-row" :data-name="n.name">
              <div class="flex min-w-[180px] flex-1 flex-col gap-0.5">
                <strong class="text-[14.5px] text-ink-900">{{ n.name }}</strong>
                <span class="text-[13px] text-ink-500">{{ t(`${n.count} appointments`, `${n.count} citas`) }}</span>
              </div>
              <select v-model="linkTarget[n.name]" data-cy="team-imported-target" :aria-label="t(`Link ${n.name} to`, `Vincular ${n.name} a`)" class="h-9 touch:h-11 w-[220px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none">
                <option :value="undefined" disabled>{{ t('Link to…', 'Vincular a…') }}</option>
                <option v-for="m in active" :key="m.id" :value="m.id">{{ m.full_name }}</option>
              </select>
              <button type="button" data-cy="team-imported-link" :disabled="!linkTarget[n.name]" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-50" @click="askLink(n)">{{ t('Link', 'Vincular') }}</button>
              <button type="button" data-cy="team-imported-invite" class="h-9 touch:h-11 rounded-ctl px-3.5 text-[14px] font-semibold text-brand-text hover:bg-surface-subtle" @click="openInvite({ name: n.name, link: n.name })">{{ t('Invite as practitioner', 'Invitar como profesional') }}</button>
            </div>
          </section>

          <!-- Require two-factor -->
          <section aria-labelledby="h-2fa" class="flex items-start gap-3.5 rounded-card border border-line bg-surface p-6" data-testid="require-two-factor">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="h-2fa" class="text-[16px] font-bold text-ink-900">{{ t('Require two-factor authentication', 'Exigir verificación en dos pasos') }}</h2>
              <p class="text-[13px] leading-snug text-ink-muted">
                {{ t('Everyone on the team signs in with their password and a 6-digit code from an authenticator app. Anyone who has not set it up is asked to the next time they open QuiroFlow.', 'Todo el equipo inicia sesión con su contraseña y un código de 6 dígitos de una app de autenticación. A quien no lo tenga configurado se le pedirá la próxima vez que abra QuiroFlow.') }}
              </p>
              <p v-if="!requireTwoFactor && !myTwoFactorVerified && !loading" class="text-[13px] font-semibold text-warning-text">
                {{ t('Set up two-factor on your own login first, in', 'Primero configura la verificación en dos pasos en tu propio acceso, en') }}
                <NuxtLink to="/account" class="underline">{{ t('Account Settings', 'Ajustes de la Cuenta') }}</NuxtLink>.
              </p>
              <p v-else-if="membersWithoutTwoFactor.length > 0" class="text-[13px] font-semibold text-warning-text">
                {{ t('Not set up yet:', 'Aún sin configurar:') }} {{ membersWithoutTwoFactor.map((m) => m.full_name).join(', ') }}
              </p>
            </div>
            <SettingsToggle
              :model-value="requireTwoFactor"
              :disabled="loading || savingRequirement || (!requireTwoFactor && !myTwoFactorVerified)"
              :aria-label="t('Require two-factor authentication', 'Exigir verificación en dos pasos')"
              @update:model-value="onRequireToggle"
            />
          </section>
        </div>
      </div>
    </div>

    <SettingsInviteDialog
      v-if="inviteOpen"
      :roles="roles"
      :seats-left="seatsLeft"
      :prefill-name="invitePrefill.name"
      :link-practitioner-name="invitePrefill.link"
      @close="inviteOpen = false"
      @created="load"
    />
    <UiConfirmDialog
      v-if="revokeFor"
      :title="t(`Revoke the invite for ${inviteTitle(revokeFor)}?`, `¿Revocar la invitación a ${inviteTitle(revokeFor)}?`)"
      :confirm-label="t('Revoke', 'Revocar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="revoke"
      @cancel="revokeFor = null"
    >
      <p class="text-[14px] text-ink-500">{{ t('The link stops working. You can invite them again whenever you like.', 'El enlace deja de funcionar. Puedes invitarle otra vez cuando quieras.') }}</p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="linkFor"
      :title="t(`Link ${linkFor.count} appointments to ${memberName(linkFor.memberId)}?`, `¿Vincular ${linkFor.count} citas a ${memberName(linkFor.memberId)}?`)"
      :confirm-label="t('Link', 'Vincular')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="linking"
      @confirm="link"
      @cancel="linkFor = null"
    >
      <p class="text-[14px] text-ink-500">{{ t(`The imported appointments under "${linkFor.name}" become theirs: in their calendar, reports and My Day. The imported name is kept on each appointment.`, `Las citas importadas a nombre de «${linkFor.name}» pasan a ser suyas: aparecerán en su calendario, sus informes y su Mi día. El nombre importado se conserva en cada cita.`) }}</p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="requireConfirmOpen"
      :title="t('Require two-factor for everyone?', '¿Exigir la verificación en dos pasos a todo el equipo?')"
      :confirm-label="t('Require it', 'Exigirla')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="setRequireTwoFactor(true)"
      @cancel="requireConfirmOpen = false"
    >
      <p class="text-[14px] text-ink-500">
        <template v-if="membersWithoutTwoFactor.length">{{ t(`${membersWithoutTwoFactor.map((m) => m.full_name).join(', ')} will have to set it up the next time they open QuiroFlow.`, `${membersWithoutTwoFactor.map((m) => m.full_name).join(', ')} tendrán que configurarla la próxima vez que abran QuiroFlow.`) }}</template>
        <template v-else>{{ t('Everyone already has it set up.', 'Todo el equipo ya la tiene configurada.') }}</template>
      </p>
    </UiConfirmDialog>
  </div>
</template>
