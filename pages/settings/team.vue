<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

interface RoleOption {
  id: string
  name: string
}

const members = ref<Tables<'team_members'>[]>([])
const invites = ref<Tables<'account_invites'>[]>([])
const roles = ref<RoleOption[]>([])
const loading = ref(true)

const inviteEmail = ref('')
const inviteRoleId = ref('')
const inviting = ref(false)
const error = ref('')
const lastInviteLink = ref('')
const emailStatus = ref<'sent' | 'failed' | ''>('')

const roleName = computed(() => {
  const byId = new Map(roles.value.map((r) => [r.id, r.name]))
  return (roleId: string | null) => (roleId ? (byId.get(roleId) ?? 'Unknown role') : 'No role')
})

async function load() {
  loading.value = true
  const [{ data: m }, { data: i }, { data: r }] = await Promise.all([
    supabase.from('team_members').select('*').is('deleted_at', null).order('full_name'),
    supabase.from('account_invites').select('*').is('accepted_at', null).order('created_at', { ascending: false }),
    supabase.from('account_roles').select('id, name').order('is_system', { ascending: false }).order('name'),
  ])
  members.value = m ?? []
  invites.value = i ?? []
  roles.value = r ?? []
  if (!inviteRoleId.value && roles.value.length > 0) {
    inviteRoleId.value = roles.value.find((role) => role.name === 'Practitioner')?.id ?? roles.value[0].id
  }
  loading.value = false
}
onMounted(load)

async function createInvite() {
  error.value = ''
  lastInviteLink.value = ''
  emailStatus.value = ''
  inviting.value = true
  const email = inviteEmail.value.trim()
  if (!email) {
    inviting.value = false
    error.value = 'Email is required.'
    return
  }
  const selectedRoleName = roles.value.find((r) => r.id === inviteRoleId.value)?.name
  const legacyRole = selectedRoleName === 'Owner' ? 'owner' : selectedRoleName === 'Front Desk' ? 'front_desk' : 'practitioner'
  const { data, error: insertError } = await supabase
    .from('account_invites')
    .insert({
      account_id: store.accountId!,
      email,
      role_id: inviteRoleId.value,
      // Legacy column still has a check constraint (owner/practitioner/front_desk) and is
      // no longer the source of truth for permissions — role_id above is. Derived from the
      // selected role's name so it stays in sync with role_id (e.g. AppSidebar's role label
      // still reads this column).
      role: legacyRole,
    })
    .select('id, token')
    .single()

  if (insertError) {
    inviting.value = false
    error.value = insertError.message
    return
  }
  lastInviteLink.value = `${window.location.origin}/join?token=${data.token}`
  inviteEmail.value = ''

  if (email) {
    try {
      await useStaffFetch('/api/invites/send', { method: 'POST', body: { inviteId: data.id } })
      emailStatus.value = 'sent'
    } catch {
      emailStatus.value = 'failed'
    }
  }

  inviting.value = false
  await load()
}

async function revokeInvite(id: string) {
  await supabase.from('account_invites').delete().eq('id', id)
  await load()
}

async function toggleBookable(member: Tables<'team_members'>) {
  const next = !member.online_booking_enabled
  member.online_booking_enabled = next
  await supabase.from('team_members').update({ online_booking_enabled: next }).eq('id', member.id)
}

// Independent of role/role_id: role governs what a person can *do* in the
// app (permissions), this governs whether they show up as a schedulable
// resource (calendar tabs, online booking) -- an Owner can also be a
// treating practitioner, and a Practitioner-role hire might not be seeing
// patients yet.
async function togglePractitioner(member: Tables<'team_members'>) {
  const next = !member.is_practitioner
  member.is_practitioner = next
  await supabase.from('team_members').update({ is_practitioner: next }).eq('id', member.id)
}

// --- Per-practitioner schedule (mirrors pages/settings/clinics.vue's
// business-hours editor) -- an empty day means "no override", not "closed":
// the practitioner stays bookable across the clinic's own hours until they
// configure something narrower here.
type Windows = [string, string][]
const WEEKDAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]
const openScheduleId = ref<string | null>(null)
const editHours = ref<Record<string, Windows>>({})
const savingHours = ref(false)

function openScheduleEditor(m: Tables<'team_members'>) {
  openScheduleId.value = openScheduleId.value === m.id ? null : m.id
  if (openScheduleId.value === m.id) {
    const hours = (m.business_hours as Record<string, Windows>) ?? {}
    editHours.value = Object.fromEntries(WEEKDAYS.map((d) => [d.key, hours[d.key] ? hours[d.key].map((w) => [...w] as [string, string]) : []]))
  }
}
function addWindow(day: string) {
  editHours.value[day].push(['09:00', '17:00'])
}
function removeWindow(day: string, i: number) {
  editHours.value[day].splice(i, 1)
}
async function saveSchedule(member: Tables<'team_members'>) {
  savingHours.value = true
  const { error: updateError } = await supabase.from('team_members').update({ business_hours: editHours.value }).eq('id', member.id)
  savingHours.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  member.business_hours = editHours.value
}
function hasScheduleOverride(m: Tables<'team_members'>) {
  const hours = m.business_hours as Record<string, Windows> | null
  return !!hours && Object.values(hours).some((w) => w.length > 0)
}

const editingId = ref<string | null>(null)
const editingName = ref('')
function startEdit(member: Tables<'team_members'>) {
  editingId.value = member.id
  editingName.value = member.full_name
}
async function saveEdit(member: Tables<'team_members'>) {
  const name = editingName.value.trim()
  editingId.value = null
  if (!name || name === member.full_name) return
  member.full_name = name
  await supabase.from('team_members').update({ full_name: name }).eq('id', member.id)
}

const resettingId = ref<string | null>(null)
async function sendPasswordReset(member: Tables<'team_members'>) {
  if (!confirm(`Send a password reset email to ${member.full_name}?`)) return
  resettingId.value = member.id
  try {
    const result = await useStaffFetch<{ email: string }>(`/api/team-members/${member.id}/reset-password`, { method: 'POST' })
    alert(`Password reset email sent to ${result.email}.`)
  } catch (e: any) {
    alert(e?.data?.statusMessage || e?.message || 'Could not send password reset.')
  } finally {
    resettingId.value = null
  }
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
}

function inviteLink(token: string) {
  return `${window.location.origin}/join?token=${token}`
}

function copy(text: string) {
  navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Team Members" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Staff accounts, roles, and invites.</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Role</th>
                  <th class="px-4 py-2">Practitioner</th>
                  <th class="px-4 py-2">Online booking</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="5" class="px-4 py-6 text-center text-ink-faint">Loading…</td>
                </tr>
                <template v-for="m in members" v-else :key="m.id">
                  <tr>
                    <td class="px-4 py-2.5 text-ink-700">
                      <span class="mr-2 inline-flex align-middle">
                        <SettingsTeamMemberPhotoUpload
                          :account-id="m.account_id"
                          :team-member-id="m.id"
                          :photo-storage-path="m.photo_storage_path"
                          :initials="initialsOf(m.full_name)"
                          :color="m.color"
                          :size="26"
                          @uploaded="load"
                        />
                      </span>
                      <input
                        v-if="editingId === m.id"
                        v-model="editingName"
                        type="text"
                        autofocus
                        class="w-48 rounded-ctlSm border border-brand-tintBorder px-1.5 py-0.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @keydown.enter="saveEdit(m)"
                        @keydown.esc="editingId = null"
                        @blur="saveEdit(m)"
                      />
                      <button v-else type="button" class="hover:text-brand-text" @click="startEdit(m)">
                        {{ m.full_name }}
                      </button>
                    </td>
                    <td class="px-4 py-2.5">
                      <UiPill tone="brand">{{ roleName(m.role_id) }}</UiPill>
                    </td>
                    <td class="px-4 py-2.5">
                      <label class="flex items-center gap-2.5 text-ink-600">
                        <SettingsToggle :model-value="m.is_practitioner" @update:model-value="togglePractitioner(m)" />
                        Practitioner
                      </label>
                    </td>
                    <td class="px-4 py-2.5">
                      <label class="flex items-center gap-2.5 text-ink-600">
                        <SettingsToggle :model-value="m.online_booking_enabled" @update:model-value="toggleBookable(m)" />
                        Bookable
                      </label>
                    </td>
                    <td class="px-4 py-2.5 text-right">
                      <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="openScheduleEditor(m)">
                        {{ hasScheduleOverride(m) ? 'Schedule (custom)' : 'Schedule' }}
                      </button>
                      <span class="mx-2 text-line-control">·</span>
                      <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" :disabled="resettingId === m.id" @click="sendPasswordReset(m)">
                        {{ resettingId === m.id ? 'Sending…' : 'Reset password' }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="openScheduleId === m.id">
                    <td colspan="5" class="border-t border-line-divider bg-surface-subtle px-4 py-4">
                      <p class="text-[12px] text-ink-muted2">
                        Leave every day empty to keep {{ m.full_name }} bookable across the clinic's own hours. Set hours here to restrict online booking to a narrower schedule.
                      </p>
                      <div class="mt-3 space-y-2">
                        <div v-for="d in WEEKDAYS" :key="d.key" class="flex items-start gap-3 text-[13px]">
                          <span class="w-10 pt-1.5 text-ink-muted2">{{ d.label }}</span>
                          <div class="flex-1 space-y-1.5">
                            <p v-if="editHours[d.key].length === 0" class="pt-1.5 text-ink-faint">No override</p>
                            <div v-for="(w, i) in editHours[d.key]" :key="i" class="flex items-center gap-2">
                              <input v-model="w[0]" type="time" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                              <span class="text-ink-faint">–</span>
                              <input v-model="w[1]" type="time" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                              <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeWindow(d.key, i)">✕</button>
                            </div>
                            <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="addWindow(d.key)">+ Add hours</button>
                          </div>
                        </div>
                      </div>
                      <UiBtn variant="primary" class="mt-4" :disabled="savingHours" @click="saveSchedule(m)">
                        {{ savingHours ? 'Saving…' : 'Save' }}
                      </UiBtn>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-if="invites.length > 0" class="mt-4">
            <h2 class="text-[13.5px] font-[560] text-ink-700">Pending invites</h2>
            <ul class="mt-2 space-y-2">
              <li v-for="inv in invites" :key="inv.id" class="flex items-center justify-between rounded-card border border-line bg-surface px-3 py-2 text-[13px] shadow-card">
                <span class="text-ink-600">{{ inv.email || 'Any email' }} &middot; {{ roleName(inv.role_id) }}</span>
                <div class="flex gap-3 text-[12.5px] font-medium">
                  <button type="button" class="text-brand-text hover:text-brand-hover" @click="copy(inviteLink(inv.token))">Copy link</button>
                  <button type="button" class="text-danger-text hover:text-danger-text/80" @click="revokeInvite(inv.id)">Revoke</button>
                </div>
              </li>
            </ul>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="createInvite">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Email</label>
              <input v-model="inviteEmail" type="email" required placeholder="colleague@example.com" class="mt-1 h-8 w-56 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Role</label>
              <select v-model="inviteRoleId" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
            </div>
            <UiBtn variant="primary" type="submit" :disabled="inviting">{{ inviting ? 'Creating…' : 'Create Invite Link' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
          <p v-if="emailStatus === 'sent'" class="mt-2 text-[12.5px] text-success-text">Invite email sent ✓</p>
          <p v-if="emailStatus === 'failed'" class="mt-2 text-[12.5px] text-warning-text">Couldn't send the invite email — share the link below instead.</p>
          <div v-if="lastInviteLink" class="mt-2 rounded-ctl border border-success-border bg-success-bg p-3 text-[12.5px] text-success-deep">
            Share this link (e.g. via WhatsApp): <span class="break-all font-medium">{{ lastInviteLink }}</span>
            <button type="button" class="ml-2 font-medium underline" @click="copy(lastInviteLink)">Copy</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
